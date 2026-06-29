// backend/src/scheduling/canEdit.js
//
// Authorization for the mutating scheduling routes. requireAuth sets
// req.user.role from the Supabase app_metadata.app_role (defaulting to 'crew'
// when unset). app_metadata is service-role-only (Admin API), NOT the
// user-writable user_metadata (audit H2). Only the roles below may create/edit
// scheduling data — set one of these as a user's app_metadata.app_role to grant
// scheduling-edit access.
export const SCHEDULING_EDITOR_ROLES = new Set([
  'admin', 'super_admin', 'primary_admin', 'owner',
  'dispatcher', 'scheduler', 'ops_control', 'sales_admin',
]);

export function canEditScheduling(role) {
  return SCHEDULING_EDITOR_ROLES.has(role);
}
