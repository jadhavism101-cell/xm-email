/**
 * XtraMiles role model — mirrored from @xtramiles/auth (monorepo packages/auth)
 *
 * Hierarchy (highest → lowest privilege):
 *   admin > ops > sales > seller > viewer
 */

export const ROLES = ['admin', 'ops', 'sales', 'seller', 'viewer'] as const

export type XmRole = (typeof ROLES)[number]

const ROLE_RANK: Record<XmRole, number> = {
  admin:  0,
  ops:    1,
  sales:  2,
  seller: 3,
  viewer: 4,
}

export function hasRole(userRole: XmRole, requiredRole: XmRole): boolean {
  return ROLE_RANK[userRole] <= ROLE_RANK[requiredRole]
}

export function isValidRole(r: string): r is XmRole {
  return (ROLES as readonly string[]).includes(r)
}

export const AUTH_COOKIE_NAME = 'xm-auth' as const
export const AUTH_ROLE_COOKIE_NAME = 'xm-role' as const

export interface XmUserProfile {
  id: string
  email: string
  name: string
  role: XmRole
  team_id: string | null
  is_active: boolean
  created_at: string
}
