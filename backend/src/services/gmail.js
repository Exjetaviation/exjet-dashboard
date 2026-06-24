import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

const getOAuthClient = () => {
  const client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return client;
};

const getGmail = () => google.gmail({ version: 'v1', auth: getOAuthClient() });

// Build a Gmail API client from an explicit OAuth config. Lets the fuel scan use a
// dedicated OAuth app (GMAIL_OPS_*) for the operations@ mailbox, isolated from the
// existing GMAIL_* app used by sending + the quotes scan.
export const gmailClientFor = ({ clientId, clientSecret, redirectUri, refreshToken }) => {
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: client });
};

export const getUnreadQuoteEmails = async () => {
  const gmail = getGmail();
  const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: `label:inbox after:${sevenDaysAgo}`,
    maxResults: 50,
  });

  const messages = res.data.messages || [];
  const emails = [];

  for (const msg of messages) {
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
    });

    const headers = detail.data.payload?.headers || [];
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    const from    = headers.find(h => h.name === 'From')?.value || '';
    const date    = headers.find(h => h.name === 'Date')?.value || '';

    let body = '';
    const parts = detail.data.payload?.parts || [];
    if (parts.length > 0) {
      const textPart = parts.find(p => p.mimeType === 'text/plain') || parts[0];
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString('utf8');
      }
    } else if (detail.data.payload?.body?.data) {
      body = Buffer.from(detail.data.payload.body.data, 'base64').toString('utf8');
    }

    emails.push({ id: msg.id, subject, from, date, body: body.slice(0, 3000) });
  }

  return emails;
};

export const markAsRead = async (messageId) => {
  const gmail = getGmail();
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { removeLabelIds: ['UNREAD'] },
  });
};

// RFC 2047-encode a header value when it contains non-ASCII (e.g. the en dash).
const encodeHeader = (s) => (/[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=` : s);

// Send an email via the Exjet Gmail. Plain text: { to, subject, body }. Rich:
// pass `html` and/or `attachments` (each { filename, content: Buffer, contentType }).
export const sendEmail = async ({ to, cc, subject, body, html, attachments = [] }) => {
  const gmail = getGmail();
  const CRLF = '\r\n';
  // Gmail routes to Cc recipients from the header; include it only when provided.
  const addr = [`To: ${to}`, ...(cc ? [`Cc: ${cc}`] : [])];
  let raw;
  if (!html && !attachments.length) {
    raw = [...addr, `Subject: ${encodeHeader(subject)}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body || ''].join(CRLF);
  } else {
    const boundary = 'exjet_' + Math.random().toString(36).slice(2);
    const lines = [
      ...addr,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      html ? 'Content-Type: text/html; charset=utf-8' : 'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      html || body || '',
    ];
    for (const att of attachments) {
      const b64 = Buffer.from(att.content).toString('base64').replace(/(.{76})/g, `$1${CRLF}`);
      lines.push(
        `--${boundary}`,
        `Content-Type: ${att.contentType || 'application/octet-stream'}; name="${att.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${att.filename}"`,
        '',
        b64,
      );
    }
    lines.push(`--${boundary}--`);
    raw = lines.join(CRLF);
  }
  const encoded = Buffer.from(raw).toString('base64url');
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } });
};

export const getAuthUrl = () => {
  const client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
  });
};

export const getTokensFromCode = async (code) => {
  const client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  const { tokens } = await client.getToken(code);
  return tokens;
};
