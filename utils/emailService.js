// ====================================================================
// Email service via Gmail SMTP + Nodemailer (backend/utils/emailService.js)
// Used to send account credentials after DO / Sub-Admin creation.
// ====================================================================

const nodemailer = require('nodemailer');

function getFromAddress() {
  return (
    process.env.EMAIL_FROM ||
    (process.env.SMTP_USER
      ? `ReeferON <${process.env.SMTP_USER.trim()}>`
      : 'ReeferON <noreply@localhost>')
  ).trim();
}

/** Install / Expo Go invite link (set MOBILE_APP_URL in .env). */
function getMobileAppUrl() {
  return (process.env.MOBILE_APP_URL || process.env.EXPO_GO_URL || '').trim();
}

/** Opens app if already installed (dev/production build). */
function getMobileDeepLink() {
  return (process.env.MOBILE_DEEP_LINK || 'reeferon://login').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCredentialsHtml({ fullName, email, password, roleLabel, includeMobile }) {
  const appUrl = getMobileAppUrl();
  const deepLink = getMobileDeepLink();

  let appBlock = '';
  if (includeMobile) {
    const parts = [];
    if (appUrl) {
      parts.push(
        `App link: <a href="${escapeHtml(appUrl)}" style="color:#0066cc;">${escapeHtml(appUrl)}</a>`
      );
    }
    if (deepLink) {
      parts.push(
        `Open app: <a href="${escapeHtml(deepLink)}" style="color:#0066cc;">${escapeHtml(deepLink)}</a>`
      );
    }
    if (parts.length) {
      appBlock = `<p>${parts.join('<br/>')}</p>`;
    }
  }

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5;">
    <p>Dear ${escapeHtml(fullName || 'User')},</p>
    <p>Your ReeferON ${escapeHtml(roleLabel)} account is ready.</p>
    <p>
      Email: ${escapeHtml(email)}<br/>
      Password: ${escapeHtml(password)}
    </p>
    ${appBlock}
    <p>Please keep your password confidential.</p>
    <p>Regards,<br/>ReeferON Team</p>
  </div>`;
}

function buildCredentialsText({ fullName, email, password, roleLabel, includeMobile }) {
  const lines = [
    `Dear ${fullName || 'User'},`,
    '',
    `Your ReeferON ${roleLabel} account is ready.`,
    '',
    `Email: ${email}`,
    `Password: ${password}`,
    ''
  ];

  if (includeMobile) {
    const appUrl = getMobileAppUrl();
    const deepLink = getMobileDeepLink();
    if (appUrl) lines.push(`App link: ${appUrl}`);
    if (deepLink) lines.push(`Open app: ${deepLink}`);
    if (appUrl || deepLink) lines.push('');
  }

  lines.push(
    'Please keep your password confidential.',
    '',
    'Regards,',
    'ReeferON Team'
  );

  return lines.join('\n');
}

function getSmtpConfig() {
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '').trim();
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false';

  return { user, pass, host, port, secure };
}

/**
 * Send a transactional email via Gmail SMTP (Nodemailer).
 * @returns {{ sent: boolean, skipped?: boolean, error?: string, id?: string }}
 */
async function sendEmail({ to, subject, html, text }) {
  const { user, pass, host, port, secure } = getSmtpConfig();

  if (!user || !pass) {
    console.warn('⚠️ SMTP_USER / SMTP_PASS not set — credentials email skipped.');
    return {
      sent: false,
      skipped: true,
      error: 'SMTP is not configured. Add SMTP_USER and SMTP_PASS (Gmail App Password) to backend/.env and restart the server.'
    };
  }

  const from = getFromAddress();
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });

  try {
    console.log(`📧 Sending credentials email to ${to} via SMTP ${host}:${port} from ${from}…`);
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: text || undefined,
      html
    });
    console.log(`📧 Email sent to ${to} (id: ${info.messageId || 'n/a'})`);
    return { sent: true, id: info.messageId || null };
  } catch (err) {
    console.error('❌ SMTP email error:', err.message);
    return { sent: false, error: err.message };
  }
}

async function sendOperatorCredentialsEmail({ email, password, full_name }) {
  const payload = {
    roleLabel: 'Data Operator',
    fullName: full_name,
    email,
    password,
    includeMobile: true
  };

  return sendEmail({
    to: email,
    subject: 'ReeferON — Login Details',
    text: buildCredentialsText(payload),
    html: buildCredentialsHtml(payload)
  });
}

async function sendSubAdminCredentialsEmail({ email, password, full_name }) {
  const payload = {
    roleLabel: 'Sub-Admin',
    fullName: full_name,
    email,
    password,
    includeMobile: false
  };

  return sendEmail({
    to: email,
    subject: 'ReeferON — Login Details',
    text: buildCredentialsText(payload),
    html: buildCredentialsHtml(payload)
  });
}

module.exports = {
  sendEmail,
  sendOperatorCredentialsEmail,
  sendSubAdminCredentialsEmail
};
