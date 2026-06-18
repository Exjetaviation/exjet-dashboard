// backend/src/scheduling/canEdit.js
//
// Authorization for the mutating scheduling routes. requireAuth sets
// req.user.role from the Supabase user_metadata.app_role (defaulting to 'crew'
// when unset). Only the roles below may create/edit scheduling data — assign one
// of these as a user's app_role in Supabase to grant scheduling-edit access.
export const SCHEDULING_EDITOR_ROLES = new Set([
  'admin', 'super_admin', 'primary_admin', 'owner',
  'dispatcher', 'scheduler', 'ops_control', 'sales_admin',
]);

export function canEditScheduling(role) {
  return SCHEDULING_EDITOR_ROLES.has(role);
}
