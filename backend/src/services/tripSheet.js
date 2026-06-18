// backend/src/services/tripSheet.js
// Fetches the official LevelFlight Flight Release / Trip Sheet HTML for a dispatch.
// The release is complete and self-contained (inline styles, no external assets), so
// it can be served to the dashboard and printed to PDF as-is. Returns null when the
// release is unavailable (e.g. unreleased trip / unknown id) so routes can 404.
import { getDispatchRelease } from './levelflight.js';

// `deps.get` is injected in tests; defaults to the real LevelFlight call.
export async function fetchReleaseHtml(dispatchId, deps = {}) {
  const get = deps.get || getDispatchRelease;
  try {
    const html = await get(dispatchId);
    return html && typeof html === 'string' && html.length ? html : null;
  } catch {
    return null;
  }
}
