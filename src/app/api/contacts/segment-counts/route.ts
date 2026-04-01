import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardSession } from '@/lib/api-security'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const SEGMENT_KEYS = ['active_customer', 'lapsed_customer', 'warm_lead', 'new_cold'] as const

async function countBySegment(segment: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('custom_fields->>segment', segment)

  if (error) {
    throw new Error(error.message)
  }

  return count ?? 0
}

export async function GET(req: NextRequest) {
  const unauthorized = requireDashboardSession(req)
  if (unauthorized) return unauthorized

  try {
    const singleSegment = req.nextUrl.searchParams.get('segment')
    if (singleSegment) {
      if (!SEGMENT_KEYS.includes(singleSegment as (typeof SEGMENT_KEYS)[number])) {
        return NextResponse.json({ error: 'Invalid segment' }, { status: 400 })
      }

      const count = await countBySegment(singleSegment)
      return NextResponse.json({ ok: true, segment: singleSegment, count })
    }

    const entries = await Promise.all(
      SEGMENT_KEYS.map(async (segment) => [segment, await countBySegment(segment)] as const),
    )

    return NextResponse.json({
      ok: true,
      counts: Object.fromEntries(entries),
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
