import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';
const P = '00000000-0000-4000-8000-000000000003', U = '00000000-0000-4000-8000-000000000004';
const origin = 'https://office-stage.example';
async function authored(file, bindings, expression) {
  let source = await readFile(new URL(file, root), 'utf8');
  source = source.replace(/^import ['"][^'"]+['"]\r?\n/gm, '')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm, '').replace(/^export /gm, '');
  return vm.runInNewContext(stripTypeScriptTypes(source) + '\n;(' + expression + ')',
    { Error, URL, ...bindings }, { filename: file });
}
async function harness(options = {}) {
  const calls = [], cookieWrites = [];
  const role = options.role ?? 'manager';
  const companies = options.companies ?? [{ companyId: A, companyName: 'A' }, { companyId: B, companyName: 'B' }];
  const tables = {
    profiles: [{ id: P, auth_user_id: U, user_id: U, ...options.profile }],
    company_members: [{ company_id: B, profile_id: P, role, is_active: true, ...options.member }],
    office_settings: [{ company_id: A, enabled: options.currentEnabled ?? true }, { company_id: B, enabled: options.targetEnabled ?? true }],
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: options.signedOut ? null : { id: U } }, error: null }) },
    from(table) {
      const filters = []; calls.push({ table, filters });
      return {
        select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
        async maybeSingle() {
          return {
            data: tables[table]?.find(row => filters.every(([key, value]) => row[key] === value)) ?? null,
            error: options.queryError === table ? {} : null,
          };
        },
      };
    },
  };
  const roles = await authored('integrations/diriqo/lib/hub-access.ts', {}, '({hasCompanyMemberRole,hasHubAccessRole})');
  const resolveActiveCompanySwitch = await authored('integrations/diriqo/lib/active-company-switch.ts', {}, 'resolveActiveCompanySwitch');
  const assertOfficeRequestOrigin = await authored('src/server/origin.ts', {}, 'assertOfficeRequestOrigin');
  const requireOfficeContext = await authored('integrations/diriqo/lib/office/context.ts', {
    getActiveCompanyContext: async options => {
      assert.deepEqual([...options.allowedRoles], ['super_admin', 'company_admin', 'manager', 'worker']);
      return { companyId: A, profileId: P, role, companyMemberships: companies };
    },
    createSupabaseServerClient: async () => supabase,
    requirePaidCompanyCapability: () => { throw Error('Selecting a company is not a document write'); },
  }, 'requireOfficeContext');
  const POST = await authored('integrations/diriqo/app/api/office/company/route.ts', {
    ...roles, resolveActiveCompanySwitch, assertOfficeRequestOrigin, requireOfficeContext,
    officePublicOrigin: () => options.publicOrigin === null ? undefined : origin,
    NextResponse: { json: (body, config) => ({ body, ...config, cookies: { set: value => cookieWrites.push(value) } }) },
  }, 'POST');
  const request = (companyId = B, extraHeaders = {}) => new Request(origin + '/api/office/company', {
    method: 'POST', headers: { origin, host: 'office-stage.example', 'sec-fetch-site': 'same-origin', ...extraHeaders },
    body: JSON.stringify({ companyId }),
  });
  return { POST, request, calls, cookieWrites, roles };
}

test('Diriqo Office manager and worker may select a live enabled company without global Hub access', async () => {
  for (const role of ['manager', 'worker']) {
    const h = await harness({ role });
    assert.equal(h.roles.hasHubAccessRole(role), false);
    const response = await h.POST(h.request());
    assert.equal(response.body.companyId, B);
    assert.equal(response.headers['Cache-Control'], 'private, no-store');
    assert.equal(h.cookieWrites.length, 1);
    assert.equal(h.cookieWrites[0].name, 'active_company_id');
    assert.equal(h.cookieWrites[0].value, B);
    assert.equal(h.cookieWrites[0].sameSite, 'lax');
    assert.deepEqual(h.calls.find(call => call.table === 'company_members').filters,
      [['company_id', B], ['profile_id', P], ['is_active', true]]);
  }
});

test('Office company selection denies foreign, inactive, another profile and unsupported role targets', async () => {
  for (const options of [
    { companies: [{ companyId: A, companyName: 'A' }] },
    { member: { is_active: false } }, { member: { profile_id: U } },
    { member: { role: 'unknown' } }, { queryError: 'company_members' },
  ]) {
    const h = await harness(options), response = await h.POST(h.request());
    assert.equal(response.status, 403); assert.equal(response.body.error, 'OFFICE_FORBIDDEN');
    assert.equal(h.cookieWrites.length, 0);
  }
});

test('Office company selection rechecks session/identity, current module and target module before touching cookies', async () => {
  for (const options of [
    { signedOut: true }, { profile: { auth_user_id: P } }, { profile: { user_id: P } },
    { currentEnabled: false }, { targetEnabled: false }, { queryError: 'profiles' }, { queryError: 'office_settings' },
  ]) {
    const h = await harness(options), response = await h.POST(h.request());
    assert.equal(response.status, 403);
    assert.match(response.body.error, /^OFFICE_(UNAUTHENTICATED|IDENTITY_MISMATCH|DISABLED)$/);
    assert.equal(h.cookieWrites.length, 0);
  }
});

test('Office company selection validates trusted origin before any auth/database work', async () => {
  for (const headers of [
    { origin: 'https://evil.example' }, { host: 'evil.example', origin: 'https://evil.example' },
    { 'sec-fetch-site': 'cross-site' }, { origin: 'null' },
  ]) {
    const h = await harness(), response = await h.POST(h.request(B, headers));
    assert.equal(response.status, 403); assert.equal(h.calls.length, 0); assert.equal(h.cookieWrites.length, 0);
  }
  const h = await harness({ publicOrigin: null }), response = await h.POST(h.request());
  assert.equal(response.body.error, 'OFFICE_ORIGIN_CONFIGURATION');
  assert.equal(h.calls.length, 0); assert.equal(h.cookieWrites.length, 0);
});

test('Office company selection rejects malformed, huge and absent target input without cookie changes', async () => {
  for (const companyId of [null, {}, '', 'foreign', 'x'.repeat(1025)]) {
    const h = await harness(), response = await h.POST(h.request(companyId));
    assert.equal(response.status, 403); assert.equal(h.cookieWrites.length, 0);
  }
});
