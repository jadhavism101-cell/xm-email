import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SESSION_SECRET = (process.env.SESSION_SECRET || 'xm-email-session-2026').trim()

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow login page and all API routes to pass through
  if (pathname.startsWith('/login') || pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  const cookie = request.cookies.get('xm-auth')
  if (cookie?.value === SESSION_SECRET) {
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
