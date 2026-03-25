import { NextResponse } from 'next/server'

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'xtramiles2026'
const SESSION_SECRET = (process.env.SESSION_SECRET || 'xm-email-session-2026').trim()

export async function POST(req: Request) {
  const { password } = await req.json()

  if (password !== DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set('xm-auth', SESSION_SECRET, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set('xm-auth', '', { maxAge: 0, path: '/' })
  return response
}
