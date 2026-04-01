import { NextResponse } from 'next/server'
import {
  AUTH_COOKIE_NAME,
  AUTH_ROLE_COOKIE_NAME,
  getDashboardPasswordConfig,
  getDashboardRoleConfig,
  getSessionSecretConfig,
} from '@/lib/auth-config'

export async function POST(req: Request) {
  const authPassword = getDashboardPasswordConfig()
  const authRole = getDashboardRoleConfig()
  const sessionSecret = getSessionSecretConfig()

  if (!authPassword.ok || !authRole.ok || !sessionSecret.ok || !authPassword.value || !authRole.value || !sessionSecret.value) {
    return NextResponse.json(
      {
        error: authPassword.error || authRole.error || sessionSecret.error || 'Dashboard auth is not configured',
      },
      { status: 500 },
    )
  }

  const body = await req.json().catch(() => null)
  const password = body && typeof body.password === 'string' ? body.password : ''

  if (password !== authPassword.value) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(AUTH_COOKIE_NAME, sessionSecret.value, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })
  response.cookies.set(AUTH_ROLE_COOKIE_NAME, authRole.value, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(AUTH_COOKIE_NAME, '', { maxAge: 0, path: '/' })
  response.cookies.set(AUTH_ROLE_COOKIE_NAME, '', { maxAge: 0, path: '/' })
  return response
}
