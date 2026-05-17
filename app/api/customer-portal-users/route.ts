import { NextRequest, NextResponse } from 'next/server'

import { getPublicAppBaseUrl } from '@/lib/public-app-url'
import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type CustomerRow = {
  id: string
  company_id: string | null
  name: string | null
}

type CustomerContactRow = {
  id: string
  customer_id: string
  email: string | null
  full_name: string | null
}

type PortalUserRow = {
  id: string
  customer_id: string
  contact_id: string | null
  auth_user_id: string
  email: string
}

function getPortalRedirectUrl(request: NextRequest) {
  return `${getPublicAppBaseUrl(request)}/portal/reset-password`
}

function normalizeText(value: unknown, maxLength: number) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  return normalized.slice(0, maxLength)
}

async function getScopedContactContext(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  companyId: string,
  customerId: string,
  contactId: string
) {
  const [customerResponse, contactResponse] = await Promise.all([
    admin
      .from('customers')
      .select('id, company_id, name')
      .eq('id', customerId)
      .maybeSingle(),
    admin
      .from('customer_contacts')
      .select('id, customer_id, email, full_name')
      .eq('id', contactId)
      .eq('customer_id', customerId)
      .maybeSingle(),
  ])

  const customer = (customerResponse.data as CustomerRow | null) ?? null
  const contact = (contactResponse.data as CustomerContactRow | null) ?? null

  if (customerResponse.error || !customer?.company_id) {
    return { error: 'Zakaznik nebyl nalezen.', status: 404 as const }
  }

  if (customer.company_id !== companyId) {
    return { error: 'Nemate pristup k teto firme.', status: 403 as const }
  }

  if (contactResponse.error || !contact?.id) {
    return { error: 'Kontakt nebyl nalezen.', status: 404 as const }
  }

  return {
    customer,
    contact,
  }
}

async function getPortalUserForContact(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  customerId: string,
  contactId: string
) {
  const portalUsersResponse = await admin
    .from('customer_portal_users')
    .select('id, customer_id, contact_id, auth_user_id, email')
    .eq('customer_id', customerId)
    .eq('contact_id', contactId)

  if (portalUsersResponse.error) {
    return { error: portalUsersResponse.error.message, status: 400 as const }
  }

  const portalUsers = (portalUsersResponse.data ?? []) as PortalUserRow[]

  if (portalUsers.length > 1) {
    return {
      error: 'Kontakt má více portálových účtů. Nejdřív opravte nekonzistentní data.',
      status: 409 as const,
    }
  }

  return {
    portalUser: portalUsers[0] ?? null,
  }
}

export async function POST(request: NextRequest) {
  try {
    const activeCompanyResult = await requireCompanyRole('super_admin', 'company_admin')

    if (!activeCompanyResult.ok) {
      return NextResponse.json({ error: activeCompanyResult.error }, { status: activeCompanyResult.status })
    }

    const activeCompany = activeCompanyResult.value

    const body = (await request.json()) as {
      customerId?: string
      contactId?: string
      email?: string
      fullName?: string
    }

    const customerId = normalizeText(body.customerId, 64)
    const contactId = normalizeText(body.contactId, 64)
    const requestedEmail = normalizeText(body.email, 320).toLowerCase()
    const requestedFullName = normalizeText(body.fullName, 160)

    if (!customerId || !contactId || !requestedEmail) {
      return NextResponse.json(
        { error: 'Chybí customerId, contactId nebo e-mail.' },
        { status: 400 }
      )
    }

    const admin = createSupabaseAdminClient()

    const scopedContext = await getScopedContactContext(
      admin,
      activeCompany.companyId,
      customerId,
      contactId
    )

    if ('error' in scopedContext) {
      return NextResponse.json({ error: scopedContext.error }, { status: scopedContext.status })
    }

    const { contact } = scopedContext

    const portalUserLookup = await getPortalUserForContact(admin, customerId, contactId)

    if ('error' in portalUserLookup) {
      return NextResponse.json({ error: portalUserLookup.error }, { status: portalUserLookup.status })
    }

    let portalUser = portalUserLookup.portalUser
    let authUserId = portalUser?.auth_user_id ?? null
    let resolvedEmail = requestedEmail
    let created = false

    if (!authUserId) {
      const tempPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`
      const createAuthResponse = await admin.auth.admin.createUser({
        email: requestedEmail,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          customer_id: customerId,
          customer_contact_id: contactId,
          full_name: requestedFullName || contact.full_name || null,
        },
      })

      if (createAuthResponse.error || !createAuthResponse.data.user?.id) {
        return NextResponse.json(
          { error: createAuthResponse.error?.message || 'Nepodařilo se vytvořit auth účet.' },
          { status: 400 }
        )
      }

      authUserId = createAuthResponse.data.user.id
      resolvedEmail = createAuthResponse.data.user.email?.trim().toLowerCase() || requestedEmail
      created = true

      const insertPortalUserResponse = await admin
        .from('customer_portal_users')
        .insert({
          customer_id: customerId,
          contact_id: contactId,
          auth_user_id: authUserId,
          email: resolvedEmail,
          full_name: requestedFullName || contact.full_name || null,
          is_active: true,
        })
        .select('id, customer_id, contact_id, auth_user_id, email')
        .single()

      if (insertPortalUserResponse.error || !insertPortalUserResponse.data) {
        await admin.auth.admin.deleteUser(authUserId)

        return NextResponse.json(
          {
            error:
              insertPortalUserResponse.error?.message ||
              'Nepodařilo se vytvořit zákaznický portálový účet.',
          },
          { status: 400 }
        )
      }

      portalUser = insertPortalUserResponse.data as PortalUserRow
    } else {
      const authUserResponse = await admin.auth.admin.getUserById(authUserId)

      if (authUserResponse.error || !authUserResponse.data.user) {
        return NextResponse.json(
          {
            error:
              authUserResponse.error?.message ||
              'Portálový auth účet nebyl nalezen pro tento kontakt.',
          },
          { status: 409 }
        )
      }

      const updateUserResponse = await admin.auth.admin.updateUserById(authUserId, {
        email: requestedEmail,
        user_metadata: {
          customer_id: customerId,
          customer_contact_id: contactId,
          full_name: requestedFullName || contact.full_name || null,
        },
      })

      if (updateUserResponse.error || !updateUserResponse.data.user) {
        return NextResponse.json(
          { error: updateUserResponse.error?.message || 'Nepodařilo se aktualizovat auth účet.' },
          { status: 400 }
        )
      }

      resolvedEmail = updateUserResponse.data.user.email?.trim().toLowerCase() || requestedEmail

      const updatePortalUserResponse = await admin
        .from('customer_portal_users')
        .update({
          customer_id: customerId,
          contact_id: contactId,
          email: resolvedEmail,
          full_name: requestedFullName || contact.full_name || null,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', portalUser?.id ?? '')
        .eq('customer_id', customerId)
        .eq('contact_id', contactId)

      if (updatePortalUserResponse.error) {
        return NextResponse.json(
          {
            error:
              updatePortalUserResponse.error.message || 'Nepodařilo se aktualizovat portálový účet.',
          },
          { status: 400 }
        )
      }
    }

    if (!authUserId || !portalUser?.id) {
      return NextResponse.json(
        { error: 'Portálový účet se nepodařilo jednoznačně navázat na kontakt.' },
        { status: 409 }
      )
    }

    const refreshedPortalUserLookup = await getPortalUserForContact(admin, customerId, contactId)

    if ('error' in refreshedPortalUserLookup) {
      return NextResponse.json(
        { error: refreshedPortalUserLookup.error },
        { status: refreshedPortalUserLookup.status }
      )
    }

    const refreshedPortalUser = refreshedPortalUserLookup.portalUser

    if (!refreshedPortalUser || refreshedPortalUser.auth_user_id !== authUserId) {
      return NextResponse.json(
        { error: 'Portálový účet už není navázaný na očekávaný kontakt.' },
        { status: 409 }
      )
    }

    const resetPasswordResponse = await admin.auth.resetPasswordForEmail(resolvedEmail, {
      redirectTo: getPortalRedirectUrl(request),
    })

    if (resetPasswordResponse.error) {
      return NextResponse.json(
        {
          error:
            resetPasswordResponse.error.message ||
            'Nepodařilo se odeslat e-mail pro nastavení hesla.',
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      created,
      portalUserId: refreshedPortalUser.id,
      authUserId,
      message: created
        ? 'Portálový přístup byl vytvořen a e-mail pro nastavení hesla byl odeslán.'
        : 'E-mail pro nastavení nebo změnu hesla byl znovu odeslán jen tomuto kontaktu.',
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Doslo k neocekavane chybe.',
      },
      { status: 500 }
    )
  }
}
