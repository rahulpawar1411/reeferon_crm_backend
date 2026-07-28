// ====================================================================
// Email service via Resend API (backend/utils/emailService.js)
// Used to send account credentials after DO / Sub-Admin creation.
// ====================================================================

const { Resend } = require('resend');

function getFromAddress() {
  const configured = (
    process.env.EMAIL_FROM ||
    process.env.RESEND_FROM ||
    'ReeferON CRM <onboarding@resend.dev>'
  ).trim();

  // Resend rejects unverified domains (e.g. raw Gmail). Prefer test sender until domain is verified.
  const emailMatch = configured.match(/<([^>]+)>/) || configured.match(/([^\s<>]+@[^\s<>]+)/);
  const rawEmail = (emailMatch?.[1] || '').toLowerCase();
  if (rawEmail.endsWith('@gmail.com') || rawEmail.endsWith('@googlemail.com') || rawEmail.endsWith('@outlook.com') || rawEmail.endsWith('@hotmail.com')) {
    console.warn(`⚠️ EMAIL_FROM "${configured}" is not a Resend-verified domain. Using onboarding@resend.dev for sending.`);
    return 'ReeferON CRM <onboarding@resend.dev>';
  }

  return configured || 'ReeferON CRM <onboarding@resend.dev>';
}

function getLoginUrl() {
  return (
    process.env.APP_LOGIN_URL ||
    process.env.FRONTEND_URL ||
    'http://localhost:3000'
  );
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCredentialsHtml({
  roleLabel,
  fullName,
  email,
  password,
  phoneNo,
  extraRows = []
}) {
  const loginUrl = getLoginUrl();
  const rows = [
    ['Full Name', fullName],
    ['Login Email (ID)', email],
    ['Password', password],
    ['Phone', phoneNo || '-'],
    ...extraRows
  ]
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;color:#64748b;font-size:13px;width:38%;">${escapeHtml(label)}</td>
        <td style="padding:10px 12px;border:1px solid #e2e8f0;color:#0f172a;font-size:13px;font-weight:700;">${escapeHtml(value)}</td>
      </tr>`
    )
    .join('');

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#00a2e8,#0081ba);padding:20px 24px;">
        <h1 style="margin:0;color:#ffffff;font-size:18px;">ReeferON CRM</h1>
        <p style="margin:6px 0 0;color:#e0f2fe;font-size:13px;">Your ${escapeHtml(roleLabel)} account is ready</p>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 14px;color:#334155;font-size:14px;line-height:1.5;">
          Hello ${escapeHtml(fullName || 'User')},<br/>
          An account has been created for you. Use the credentials below to sign in.
        </p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">${rows}</table>
        <p style="margin:0 0 16px;color:#64748b;font-size:12px;line-height:1.5;">
          For security, please change your password after first login if required by your administrator.
        </p>
        <a href="${escapeHtml(loginUrl)}"
           style="display:inline-block;background:#00a2e8;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:700;">
          Open Login Portal
        </a>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px;">
        This is an automated message from ReeferON CRM. Do not share your password.
      </div>
    </div>
  </div>`;
}

/**
 * Send a transactional email via Resend.
 * @returns {{ sent: boolean, skipped?: boolean, error?: string, id?: string }}
 */
async function sendEmail({ to, subject, html }) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('⚠️ RESEND_API_KEY not set — credentials email skipped. Restart backend after adding the key to .env.');
    return { sent: false, skipped: true, error: 'RESEND_API_KEY is not configured. Add it to backend/.env and restart the server.' };
  }

  const resend = new Resend(apiKey);
  const from = getFromAddress();

  try {
    console.log(`📧 Sending credentials email to ${to} from ${from}…`);
    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject,
      html
    });

    if (error) {
      const msg = error.message || (typeof error === 'string' ? error : JSON.stringify(error));
      console.error('❌ Resend email error:', error);
      return { sent: false, error: msg };
    }

    console.log(`📧 Email sent to ${to} (id: ${data?.id || 'n/a'})`);
    return { sent: true, id: data?.id || null };
  } catch (err) {
    console.error('❌ Resend email exception:', err.message);
    return { sent: false, error: err.message };
  }
}

async function sendOperatorCredentialsEmail({
  email,
  password,
  full_name,
  phone_no,
  warehouse_name
}) {
  const html = buildCredentialsHtml({
    roleLabel: 'Data Operator',
    fullName: full_name,
    email,
    password,
    phoneNo: phone_no,
    extraRows: [['Warehouse', warehouse_name || '-']]
  });

  return sendEmail({
    to: email,
    subject: 'ReeferON CRM — Your Data Operator login credentials',
    html
  });
}

async function sendSubAdminCredentialsEmail({
  email,
  password,
  full_name,
  phone_no,
  allowed_clients,
  allowed_warehouses
}) {
  const clients =
    Array.isArray(allowed_clients) && allowed_clients.length
      ? allowed_clients.join(', ')
      : allowed_clients || 'All clients';
  const warehouses =
    Array.isArray(allowed_warehouses) && allowed_warehouses.length
      ? allowed_warehouses.join(', ')
      : allowed_warehouses || 'All warehouses';

  const html = buildCredentialsHtml({
    roleLabel: 'Sub-Admin',
    fullName: full_name,
    email,
    password,
    phoneNo: phone_no,
    extraRows: [
      ['Allowed Clients', clients],
      ['Allowed Warehouses', warehouses]
    ]
  });

  return sendEmail({
    to: email,
    subject: 'ReeferON CRM — Your Sub-Admin login credentials',
    html
  });
}

module.exports = {
  sendEmail,
  sendOperatorCredentialsEmail,
  sendSubAdminCredentialsEmail
};
