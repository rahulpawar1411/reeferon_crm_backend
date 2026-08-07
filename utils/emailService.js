// ====================================================================
// Email service via Resend HTTPS API (backend/utils/emailService.js)
// SMTP disabled — often blocked on Render free tier.
// ====================================================================

function getFromAddress() {
  return (process.env.EMAIL_FROM || 'ReeferON <onboarding@resend.dev>').trim();
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

/**
 * Send transactional email via Resend.
 * @returns {{ sent: boolean, skipped?: boolean, error?: string, id?: string }}
 */
async function sendEmail({ to, subject, html, text }) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const from = getFromAddress();

  if (!apiKey) {
    console.warn('⚠️ RESEND_API_KEY not set — credentials email skipped.');
    return {
      sent: false,
      skipped: true,
      error: 'RESEND_API_KEY is not configured. Add it to backend/.env (and Render env) then restart.'
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    console.log(`📧 Sending credentials email to ${to} via Resend from ${from}…`);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text: text || undefined
      }),
      signal: controller.signal
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.message || body?.error?.message || `Resend HTTP ${res.status}`;
      console.error('❌ Resend email error:', msg);
      return { sent: false, error: msg };
    }

    console.log(`📧 Email sent to ${to} (id: ${body.id || 'n/a'})`);
    return { sent: true, id: body.id || null };
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Resend request timed out' : err.message;
    console.error('❌ Resend email error:', msg);
    return { sent: false, error: msg };
  } finally {
    clearTimeout(timer);
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
