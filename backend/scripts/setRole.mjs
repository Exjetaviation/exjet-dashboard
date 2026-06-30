// backend/scripts/setRole.mjs
//
// Grant (or change) a user's authorization role by setting app_metadata.app_role —
// the ONLY place the backend reads the role from (middleware/role.js). The Supabase
// dashboard's metadata field writes user_metadata, which is user-writable and is
// deliberately IGNORED (audit H2), so roles MUST be set here / via the Admin API.
//
// Run from backend/:
//   node scripts/setRole.mjs <email> <role> [--dry-run]
// Examples:
//   node scripts/setRole.mjs jane@flyexjet.vip dispatcher
//   node scripts/setRole.mjs jane@flyexjet.vip crew --dry-run
//
// Idempotent. Merges app_metadata (other keys preserved). The user must sign out and
// back in afterward to refresh their session token.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { roleFromUser } from '../src/middleware/role.js';
import { canEditScheduling, SCHEDULING_EDITOR_ROLES } from '../src/scheduling/canEdit.js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [email, role] = args.filter((a) => !a.startsWith('--'));

// 'crew' is the default (no edit access); the rest are the recognized editor roles.
const VALID_ROLES = new Set(['crew', ...SCHEDULING_EDITOR_ROLES]);

if (!email || !role) {
  console.error('Usage: node scripts/setRole.mjs <email> <role> [--dry-run]');
  console.error(`Valid roles: ${[...VALID_ROLES].join(', ')}`);
  process.exit(1);
}
if (!VALID_ROLES.has(role)) {
  console.error(`Unknown role '${role}'. Valid roles: ${[...VALID_ROLES].join(', ')}`);
  process.exit(1);
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Find the user by email (paginated; listUsers caps at 1000/page).
const target = email.toLowerCase();
let user = null, page = 1;
for (;;) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  user = (data?.users || []).find((u) => (u.email || '').toLowerCase() === target);
  if (user || !data || data.users.length < 1000) break;
  page++;
}
if (!user) { console.error(`No user found with email ${email}`); process.exit(1); }

const before = roleFromUser(user);
console.log(`${email}: current app_role=${user.app_metadata?.app_role ?? 'none'} (effective=${before}, editor=${canEditScheduling(before)})`);

if (dryRun) {
  console.log(`[dry-run] would set app_metadata.app_role='${role}' (editor=${canEditScheduling(role)})`);
  process.exit(0);
}

const { data: upd, error } = await sb.auth.admin.updateUserById(user.id, {
  app_metadata: { ...(user.app_metadata || {}), app_role: role },
});
if (error) throw error;

const after = roleFromUser(upd.user);
console.log(`${email}: set app_role='${after}' (editor=${canEditScheduling(after)})`);
console.log('Done. The user must sign out and back in to refresh their session.');
