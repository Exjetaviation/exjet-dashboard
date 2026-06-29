// Pure authorization-role resolver. The role comes from app_metadata.app_role,
// which is settable ONLY via the Supabase service-role Admin API — never from
// user_metadata, which a logged-in user can write themselves via
// supabase.auth.updateUser({ data }) (audit finding H2). Kept dependency-free so
// it is unit-testable without constructing a Supabase client.
export function roleFromUser(user) {
  return user?.app_metadata?.app_role || 'crew';
}
