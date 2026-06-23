// backend/src/slack/resolveMembers.js
//
// Resolve a channel's people into a deduped list of Slack user ids to invite.
// Pure/sync — the caller performs async lookups and passes them as functions.
//
//   crew:            [{ oid, name, email|null }]
//   fixedGroupIds:   string[]  (already Slack ids; always invited)
//   dirEmailForOid:  (oid)   => email|null   (LF user directory)
//   slackIdForEmail: (email) => slackId|null (users.lookupByEmail results)
//   overrideForEmail:(email) => slackId|null (slack_user_overrides)
// Returns { inviteIds: string[], unmatched: [{ name, email|null }] }.
export function resolveMembers({
  crew = [],
  fixedGroupIds = [],
  dirEmailForOid = () => null,
  slackIdForEmail = () => null,
  overrideForEmail = () => null,
} = {}) {
  const ids = new Set(fixedGroupIds.filter(Boolean));
  const unmatched = [];
  for (const c of crew) {
    const email = (c.email || dirEmailForOid(c.oid) || '').toLowerCase() || null;
    const slackId = email ? (slackIdForEmail(email) || overrideForEmail(email)) : null;
    if (slackId) ids.add(slackId);
    else unmatched.push({ name: c.name || null, email });
  }
  return { inviteIds: [...ids], unmatched };
}
