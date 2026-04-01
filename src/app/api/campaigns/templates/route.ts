import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardSession } from '@/lib/api-security'
import { listBrevoTemplates } from '@/lib/brevo'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const unauthorized = requireDashboardSession(req)
  if (unauthorized) return unauthorized

  if (!process.env.BREVO_API_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error: 'BREVO_API_KEY is not configured',
      },
      { status: 500 },
    )
  }

  try {
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') || '50'), 1), 100)
    const templates = await listBrevoTemplates(limit)

    return NextResponse.json({
      ok: true,
      items: templates,
    })
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
