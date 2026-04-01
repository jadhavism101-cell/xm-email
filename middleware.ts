import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { AUTH_COOKIE_NAME, getSessionSecretConfig } from '@/lib/auth-config'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow login page and all API routes to pass through
  if (pathname.startsWith('/login') || pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  const sessionSecret = getSessionSecretConfig()
  if (!sessionSecret.ok || !sessionSecret.value) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('from', pathname)
    url.searchParams.set('error', 'config')
    return NextResponse.redirect(url)
  }

  const cookie = request.cookies.get(AUTH_COOKIE_NAME)
  if (cookie?.value === sessionSecret.value) {
    return NextResponse.next()
  }

  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('from', pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
