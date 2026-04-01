import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardSession } from '@/lib/api-security'
import { supabaseAdmin } from '@/lib/supabase'
import {
  toCampaignDraftPayload,
  type CampaignDraftPayload,
} from '@/lib/campaign-draft'
import { estimateCampaignAudience, type AudienceEstimate } from '@/lib/campaign-preflight'

export const dynamic = 'force-dynamic'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

type RequestBody = {
  prompt?: string
  sessionId?: string | null
}

const SYSTEM_PROMPT = [
  'You are an expert CRM email campaign strategist for XtraMiles.',
  'Output concise and actionable sequences for B2B logistics outreach.',
  'Always return JSON with keys: title, goal, campaign_type, target_segment, exit_conditions, steps, notes.',
  'Each step must include day_offset, subject, preview_text, body_outline, cta_text, cta_url.',
  'For target_segment, prefer canonical values from: active_customer, lapsed_customer, warm_lead, never_ordered, new_cold.',
  'Keep tone human and practical.',
].join(' ')

function toGeminiContents(messages: ChatMessage[]) {
  return messages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }))
}

function extractGeminiText(payload: unknown): string {
  const obj = payload as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>
      }
    }>
  }

  const first = obj?.candidates?.[0]
  const parts = first?.content?.parts || []
  const text = parts
    .map((part) => part.text || '')
    .join('\n')
    .trim()

  return text || 'Unable to generate response.'
}


export async function POST(req: NextRequest) {
  const unauthorized = requireDashboardSession(req)
  if (unauthorized) return unauthorized

  const apiKey = (process.env.GEMINI_API_KEY || '').trim()
  const model = (process.env.GEMINI_MODEL || 'gemini-1.5-flash').trim()
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: 'GEMINI_API_KEY is not configured',
      },
      { status: 500 },
    )
  }

  try {
    const body = (await req.json()) as RequestBody
    const prompt = String(body.prompt || '').trim()
    if (!prompt) {
      return NextResponse.json({ ok: false, error: 'prompt is required' }, { status: 400 })
    }

    let sessionId = body.sessionId || null
    let history: ChatMessage[] = []

    if (sessionId) {
      const { data: existing } = await supabaseAdmin
        .from('campaign_ai_sessions')
        .select('id, messages')
        .eq('id', sessionId)
        .single()

      if (existing && Array.isArray(existing.messages)) {
        history = existing.messages as ChatMessage[]
      }
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
    }

    const fullConversation: ChatMessage[] = history.length > 0 ? [...history, userMessage] : [userMessage]

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: toGeminiContents(fullConversation),
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1800,
          },
        }),
        cache: 'no-store',
      },
    )

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json(
        {
          ok: false,
          error: `Gemini request failed [${res.status}] ${text}`,
        },
        { status: 500 },
      )
    }

    const geminiPayload = await res.json()
    const assistantText = extractGeminiText(geminiPayload)
    let draft: CampaignDraftPayload | null = null
    let audienceEstimate: AudienceEstimate | null = null
    let draftParseError: string | null = null

    try {
      draft = toCampaignDraftPayload(assistantText)
      audienceEstimate = await estimateCampaignAudience(draft)
    } catch (error) {
      draftParseError = error instanceof Error ? error.message : 'Failed to parse AI draft'
    }

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: assistantText,
      timestamp: new Date().toISOString(),
    }

    const updatedMessages = [...fullConversation, assistantMessage]

    if (sessionId) {
      await supabaseAdmin
        .from('campaign_ai_sessions')
        .update({
          messages: updatedMessages,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId)
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from('campaign_ai_sessions')
        .insert({
          campaign_id: null,
          messages: updatedMessages,
          created_by: 'ai-builder',
        })
        .select('id')
        .single()

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      }
      sessionId = inserted.id as string
    }

    return NextResponse.json({
      ok: true,
      sessionId,
      response: assistantText,
      messages: updatedMessages,
      draft,
      audienceEstimate,
      draftParseError,
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
