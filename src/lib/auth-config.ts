import { AUTH_COOKIE_NAME, AUTH_ROLE_COOKIE_NAME, isValidRole, type XmRole } from './auth'

export { AUTH_COOKIE_NAME, AUTH_ROLE_COOKIE_NAME }

type ConfigResult<T = string> = {
  ok: boolean
  value: T | null
  error?: string
}

function readRequiredEnv(name: 'DASHBOARD_PASSWORD' | 'SESSION_SECRET'): ConfigResult<string> {
  const value = (process.env[name] || '').trim()
  if (!value) {
    return {
      ok: false,
      value: null,
      error: `${name} is not configured`,
    }
  }

  return {
    ok: true,
    value,
  }
}

export function getDashboardPasswordConfig(): ConfigResult {
  return readRequiredEnv('DASHBOARD_PASSWORD')
}

export function getSessionSecretConfig(): ConfigResult {
  return readRequiredEnv('SESSION_SECRET')
}

export function getDashboardRoleConfig(): ConfigResult<XmRole> {
  const role = (process.env.DASHBOARD_ROLE || 'admin').trim().toLowerCase()
  if (!isValidRole(role)) {
    return {
      ok: false,
      value: null,
      error: `DASHBOARD_ROLE must be one of: admin, ops, sales, seller, viewer`,
    }
  }

  return {
    ok: true,
    value: role,
  }
}