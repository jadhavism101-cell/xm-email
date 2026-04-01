import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardRole, requireDashboardSession } from '@/lib/api-security'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const SETTINGS_OWNER = 'system/settings'

type SenderProfile = {
  name: string
  email: string
  note: string
}

type CampaignSettings = {
  brevoApiKey: string
  sendingDomain: string
  maxEmailsPerContactPerDay: number
  defaultSendTime: string
  senderProfiles: SenderProfile[]
}

const DEFAULT_SETTINGS: CampaignSettings = {
  brevoApiKey: '',
  sendingDomain: '',
  maxEmailsPerContactPerDay: 1,
  defaultSendTime: '10:00',
  senderProfiles: [
    {
      name: 'Sales drips',
      email: 'saurabh@xtramiles.com',
      note: 'Uses assigned salesperson name',
    },
    {
      name: 'Onboarding',
      email: 'team@xtramiles.com',
      note: 'Generic team sender',
    },
    {
      name: 'Re-engagement',
      email: 'saurabh@xtramiles.com',
      note: 'Founder touch - feels personal',
    },
  ],
}

function normalizeSettings(input: unknown): CampaignSettings {
  const parsed = (input ?? {}) as Partial<CampaignSettings>

  return {
    brevoApiKey: typeof parsed.brevoApiKey === 'string' ? parsed.brevoApiKey : '',
    sendingDomain: typeof parsed.sendingDomain === 'string' ? parsed.sendingDomain : '',
    maxEmailsPerContactPerDay:
      typeof parsed.maxEmailsPerContactPerDay === 'number' && parsed.maxEmailsPerContactPerDay > 0
        ? Math.floor(parsed.maxEmailsPerContactPerDay)
        : 1,
    defaultSendTime: typeof parsed.defaultSendTime === 'string' ? parsed.defaultSendTime : '10:00',
    senderProfiles: Array.isArray(parsed.senderProfiles)
      ? parsed.senderProfiles
          .filter((profile) => profile && typeof profile === 'object')
          .map((profile) => {
            const p = profile as Partial<SenderProfile>
            return {
              name: typeof p.name === 'string' ? p.name : '',
              email: typeof p.email === 'string' ? p.email : '',
              note: typeof p.note === 'string' ? p.note : '',
            }
          })
      : DEFAULT_SETTINGS.senderProfiles,
  }
}

function serializeSettings(settings: CampaignSettings) {
  return [
    {
      role: 'assistant',
      content: JSON.stringify(settings),
      timestamp: new Date().toISOString(),
    },
  ]
}

async function loadStoredSettings(): Promise<{ id: string; settings: CampaignSettings } | null> {
  const { data, error } = await supabaseAdmin
    .from('campaign_ai_sessions')
    .select('id, messages')
    .eq('created_by', SETTINGS_OWNER)
    .is('campaign_id', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  const messages = Array.isArray(data.messages) ? data.messages : []
  const firstMessage = messages[0] as { content?: string } | undefined
  if (!firstMessage?.content) return { id: data.id as string, settings: DEFAULT_SETTINGS }

  try {
    return {
      id: data.id as string,
      settings: normalizeSettings(JSON.parse(firstMessage.content)),
    }
  } catch {
    return { id: data.id as string, settings: DEFAULT_SETTINGS }
  }
}

export async function GET(req: NextRequest) {
  const unauthorized = requireDashboardSession(req)
  if (unauthorized) return unauthorized

  try {
    const stored = await loadStoredSettings()
    return NextResponse.json({ ok: true, settings: stored?.settings ?? DEFAULT_SETTINGS })
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

export async function POST(req: NextRequest) {
  const forbidden = requireDashboardRole(req, 'ops')
  if (forbidden) return forbidden

  try {
    const body = await req.json()
    const settings = normalizeSettings(body?.settings)
    const stored = await loadStoredSettings()

    if (stored?.id) {
      const { error } = await supabaseAdmin
        .from('campaign_ai_sessions')
        .update({
          messages: serializeSettings(settings),
        })
        .eq('id', stored.id)

      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabaseAdmin.from('campaign_ai_sessions').insert({
        campaign_id: null,
        messages: serializeSettings(settings),
        created_by: SETTINGS_OWNER,
      })

      if (error) throw new Error(error.message)
    }

    return NextResponse.json({ ok: true, settings })
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
