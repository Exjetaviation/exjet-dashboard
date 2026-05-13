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

export const sendEmail = async ({ to, subject, body }) => {
  const gmail = getGmail();
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\n');

  const encoded = Buffer.from(message).toString('base64url');
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  });
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
