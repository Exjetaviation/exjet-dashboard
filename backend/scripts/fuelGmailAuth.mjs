// One-time: mint a refresh token for the operations@ fuel mailbox using the DEDICATED
// GMAIL_OPS_* OAuth app (isolated from the GMAIL_* app). Run locally from backend/.
//   node scripts/fuelGmailAuth.mjs          -> prints the consent URL
//   node scripts/fuelGmailAuth.mjs <code>   -> exchanges the ?code= for a refresh token
import 'dotenv/config';
import { google } from 'googleapis';

const client = new google.auth.OAuth2(
  process.env.GMAIL_OPS_CLIENT_ID,
  process.env.GMAIL_OPS_CLIENT_SECRET,
  process.env.GMAIL_OPS_REDIRECT_URI,
);
const code = process.argv[2];
if (!code) {
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  });
  console.log('1) Open this URL while logged in as operations@flyexjet.vip:\n' + url +
    '\n\n2) After consent, copy the `code` query param from the redirect and run:\n   node scripts/fuelGmailAuth.mjs <code>');
} else {
  const { tokens } = await client.getToken(code);
  console.log(tokens.refresh_token
    ? '\nAdd this to env (local + Railway):\nGMAIL_OPS_REFRESH_TOKEN=' + tokens.refresh_token
    : '\nNo refresh_token returned — re-run the URL (prompt=consent is set, access_type=offline).');
}
