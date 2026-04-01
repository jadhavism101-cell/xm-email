import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, AUTH_ROLE_COOKIE_NAME, getDashboardRoleConfig, getSessionSecretConfig } from './auth-config'
import { hasRole, isValidRole, type XmRole } from './auth'

function safeEquals(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left)
  const rightBuf = Buffer.from(right)
  if (leftBuf.length !== rightBuf.length) return false
  return timingSafeEqual(leftBuf, rightBuf)
}

function unauthorized(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 })
}

function forbidden(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 })
}

function misconfigured(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 500 })
}

/**
 * Enforces the same cookie-based auth used by the dashboard UI.
 */
export function requireDashboardSession(req: NextRequest): NextResponse | null {
  const sessionSecret = getSessionSecretConfig()
  if (!sessionSecret.ok || !sessionSecret.value) {
    return misconfigured(sessionSecret.error || 'SESSION_SECRET is not configured')
  }

  const sessionCookie = req.cookies.get(AUTH_COOKIE_NAME)?.value || ''
  if (!sessionCookie || !safeEquals(sessionCookie, sessionSecret.value)) {
    return unauthorized('Unauthorized')
  }

  return null
}

function resolveDashboardRole(req: NextRequest): XmRole | null {
  const cookieRole = (req.cookies.get(AUTH_ROLE_COOKIE_NAME)?.value || '').trim().toLowerCase()
  if (cookieRole) {
    return isValidRole(cookieRole) ? cookieRole : null
  }

  const roleConfig = getDashboardRoleConfig()
  if (!roleConfig.ok || !roleConfig.value) {
    return null
  }

  return roleConfig.value
}

/**
 * Enforces session auth plus minimum role requirement.
 */
export function requireDashboardRole(req: NextRequest, requiredRole: XmRole): NextResponse | null {
  const sessionError = requireDashboardSession(req)
  if (sessionError) return sessionError

  const role = resolveDashboardRole(req)
  if (!role) {
    return misconfigured('DASHBOARD_ROLE is not configured or invalid')
  }

  if (!hasRole(role, requiredRole)) {
    return forbidden('Forbidden')
  }

  return null
}

/**
 * Verifies Brevo webhook authenticity with either:
 * - shared secret token (header or query), and/or
 * - optional HMAC signature (sha256)
 */
export function verifyBrevoWebhookRequest(req: NextRequest, rawBody: string): NextResponse | null {
  const webhookSecret = (process.env.BREVO_WEBHOOK_SECRET || '').trim()
  if (webhookSecret) {
    const candidate =
      req.headers.get('x-brevo-webhook-secret') ||
      req.headers.get('x-webhook-secret') ||
      req.nextUrl.searchParams.get('token') ||
      ''

    if (!candidate || !safeEquals(candidate, webhookSecret)) {
      return unauthorized('Invalid webhook secret')
    }
  } else if (process.env.NODE_ENV === 'production') {
    return misconfigured('BREVO_WEBHOOK_SECRET is not configured')
  }

  const signingSecret = (process.env.BREVO_WEBHOOK_SIGNING_SECRET || '').trim()
  if (signingSecret) {
    const providedSignature =
      req.headers.get('x-brevo-signature') ||
      req.headers.get('x-mailin-signature') ||
      req.headers.get('x-sib-signature') ||
      ''

    if (!providedSignature) {
      return unauthorized('Missing webhook signature')
    }

    const digest = createHmac('sha256', signingSecret).update(rawBody).digest('hex')
    const prefixedDigest = `sha256=${digest}`

    const signatureValid =
      safeEquals(providedSignature, digest) ||
      safeEquals(providedSignature, prefixedDigest)

    if (!signatureValid) {
      return unauthorized('Invalid webhook signature')
    }
  }

  return null
}
