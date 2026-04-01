import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardRole } from '@/lib/api-security'
import { registerBrevoWebhook } from '@/lib/brevo'

export const dynamic = 'force-dynamic'

function buildWebhookUrl(req: NextRequest): string {
  const configuredBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim()
  const baseUrl = configuredBaseUrl || req.nextUrl.origin
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')

  const secret = (process.env.BREVO_WEBHOOK_SECRET || '').trim()
  if (secret) {
    return `${normalizedBaseUrl}/api/webhooks/brevo?token=${encodeURIComponent(secret)}`
  }

  return `${normalizedBaseUrl}/api/webhooks/brevo`
}

export async function POST(req: NextRequest) {
  const forbidden = requireDashboardRole(req, 'ops')
  if (forbidden) return forbidden

  if (!process.env.BREVO_API_KEY?.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'BREVO_API_KEY is not configured',
      },
      { status: 500 },
    )
  }

  try {
    const webhookUrl = buildWebhookUrl(req)
    const result = await registerBrevoWebhook(webhookUrl)

    if (!result?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Failed to register webhook with Brevo',
        },
        { status: 502 },
      )
    }

    return NextResponse.json({
      ok: true,
      id: result.id,
      alreadyExists: Boolean(result.alreadyExists),
      webhookUrl,
      events: ['delivered', 'opened', 'clicked', 'softBounce', 'hardBounce', 'unsubscribed', 'spam'],
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
