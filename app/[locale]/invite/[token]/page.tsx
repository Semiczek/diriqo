import { redirect } from 'next/navigation'

type Props = {
  params: Promise<{
    token: string
  }>
}

export default async function LocaleInvitePage({ params }: Props) {
  const { token } = await params
  redirect(`/invite/${encodeURIComponent(token)}`)
}
