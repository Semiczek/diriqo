import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: 'Public lead intake is disabled for this Diriqo edition.',
    },
    { status: 410 },
  )
}
