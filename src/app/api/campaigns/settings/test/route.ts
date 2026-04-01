import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardRole } from '@/lib/api-security'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const forbidden = requireDashboardRole(req, 'ops')
  if (forbidden) return forbidden

  try {
    const body = await req.json()
    const apiKey = String(body?.apiKey || '').trim()

    if (!apiKey) {
      return NextResponse.json({ ok: false, error: 'Brevo API key is required' }, { status: 400 })
    }

    const res = await fetch('https://api.brevo.com/v3/account', {
      method: 'GET',
      headers: {
        'api-key': apiKey,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json(
        {
          ok: false,
          error: `Brevo test failed [${res.status}] ${text}`,
        },
        { status: 400 },
      )
    }

    return NextResponse.json({ ok: true, message: 'Brevo connection successful' })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
