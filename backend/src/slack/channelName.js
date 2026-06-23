// backend/src/slack/channelName.js
//
// Build a Slack-safe channel name from a LevelFlight trip number.
// kind: 'ops' -> "trip-<n>", 'acct' -> "trip-<n>-acct".
export function channelName(tripId, kind) {
  const slug = String(tripId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = `trip-${slug || 'unknown'}`;
  const name = kind === 'acct' ? `${base}-acct` : base;
  return name.slice(0, 80); // Slack channel-name max length
}
