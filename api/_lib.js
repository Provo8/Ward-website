// api/_lib.js
// Shared config, Gmail transporter, and email templates for the
// send-email and cancel-appointment Vercel functions.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });

const crypto = require("crypto");
const nodemailer = require("nodemailer");

const SUPABASE_URL = "https://dvsuzohrgbrwkgzsylbp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2c3V6b2hyZ2Jyd2tnenN5bGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2OTAwOTUsImV4cCI6MjEwMzI2NjA5NX0.qXRW92s1BaiAT3uPGWBxe-UnMEPLYJamYs-JtyCJNR8";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// ── Admin session tokens ──────────────────────────────────────────
// Signed with the server-only ADMIN_PIN so a token can only have been
// issued by api/admin-login.js after a correct PIN was submitted.
function signAdminPayload(payloadB64) {
  return crypto.createHmac("sha256", process.env.ADMIN_PIN).update(payloadB64).digest("hex");
}

function verifyAdminToken(token) {
  if (!token || typeof token !== "string" || !process.env.ADMIN_PIN) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, signature] = parts;

  const expected = signAdminPayload(payloadB64);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    return typeof payload.exp === "number" && Date.now() < payload.exp;
  } catch (e) {
    return false;
  }
}

function renderConfirmationHtml({ name, title, formattedDate, formattedTime, location, notes, gcalUrl, cancelUrl, rescheduleUrl }) {
  const detailRow = (label, value) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #ebf2f8;font-size:11px;font-weight:700;color:#8b8f98;text-transform:uppercase;letter-spacing:.4px;vertical-align:top;width:92px">${label}</td>
      <td style="padding:12px 0;border-bottom:1px solid #ebf2f8;font-size:14px;font-weight:600;color:#001b35;vertical-align:top">${value}</td>
    </tr>`;

  const buttons = (cancelUrl || rescheduleUrl) ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">
      <tr>
        ${rescheduleUrl ? `<td width="${cancelUrl ? "50%" : "100%"}" style="padding-right:${cancelUrl ? "6px" : "0"}">
          <a href="${rescheduleUrl}" style="display:block;text-align:center;background:#ebf2f8;color:#001b35;font-weight:700;font-size:13px;padding:12px 10px;border-radius:10px;text-decoration:none">Reschedule</a>
        </td>` : ""}
        ${cancelUrl ? `<td width="${rescheduleUrl ? "50%" : "100%"}" style="padding-left:${rescheduleUrl ? "6px" : "0"}">
          <a href="${cancelUrl}" style="display:block;text-align:center;background:#fff;color:#ba1a1a;font-weight:700;font-size:13px;padding:12px 10px;border-radius:10px;text-decoration:none;border:1px solid #f0d9d7">Cancel</a>
        </td>` : ""}
      </tr>
    </table>` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;border:1px solid #e8edf3">
        <tr><td style="padding:36px 36px 28px;text-align:center">
          <span style="display:inline-block;background:#fed000;color:#231b00;font-size:11px;font-weight:800;padding:5px 14px;border-radius:9999px;text-transform:uppercase;letter-spacing:.5px">Appointment Confirmed</span>
          <h1 style="font-size:22px;font-weight:800;color:#001b35;margin:16px 0 6px;line-height:1.3">${title}</h1>
          <p style="font-size:14px;color:#73777f;margin:0;line-height:1.5">Hi ${name}, your meeting with ward leadership is scheduled.</p>
        </td></tr>
        <tr><td style="padding:0 36px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #edf2f7">
            <tr><td style="padding:6px 20px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${detailRow("Date", formattedDate)}
                ${detailRow("Time", formattedTime)}
                ${detailRow("Location", location)}
                ${notes ? detailRow("Notes", notes).replace('border-bottom:1px solid #ebf2f8;', '') : ""}
              </table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:28px 36px 8px">
          <a href="${gcalUrl}" target="_blank" style="display:block;text-align:center;background:#fed000;color:#231b00;font-weight:700;font-size:15px;padding:14px 20px;border-radius:12px;text-decoration:none">Add to Google Calendar</a>
          ${buttons}
        </td></tr>
        <tr><td style="padding:24px 36px 36px;text-align:center;border-top:1px solid #f0f3f7;margin-top:8px">
          <p style="font-size:12px;color:#9a9ea6;line-height:1.6;margin:20px 0 0">You'll get email reminders 24 hours and 30 minutes before your meeting.<br>Provo YSA 8th Ward &bull; Bishopric Interview Portal</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

function renderReminderHtml({ name, title, formattedDate, formattedTime, location, notes, gcalUrl, cancelUrl, rescheduleUrl, label }) {
  const whenText = label === "24h" ? "24 hours" : "30 minutes";

  const detailRow = (labelText, value) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #ebf2f8;font-size:11px;font-weight:700;color:#8b8f98;text-transform:uppercase;letter-spacing:.4px;vertical-align:top;width:92px">${labelText}</td>
      <td style="padding:12px 0;border-bottom:1px solid #ebf2f8;font-size:14px;font-weight:600;color:#001b35;vertical-align:top">${value}</td>
    </tr>`;

  const buttons = (cancelUrl || rescheduleUrl) ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">
      <tr>
        ${rescheduleUrl ? `<td width="${cancelUrl ? "50%" : "100%"}" style="padding-right:${cancelUrl ? "6px" : "0"}">
          <a href="${rescheduleUrl}" style="display:block;text-align:center;background:#ebf2f8;color:#001b35;font-weight:700;font-size:13px;padding:12px 10px;border-radius:10px;text-decoration:none">Reschedule</a>
        </td>` : ""}
        ${cancelUrl ? `<td width="${rescheduleUrl ? "50%" : "100%"}" style="padding-left:${rescheduleUrl ? "6px" : "0"}">
          <a href="${cancelUrl}" style="display:block;text-align:center;background:#fff;color:#ba1a1a;font-weight:700;font-size:13px;padding:12px 10px;border-radius:10px;text-decoration:none;border:1px solid #f0d9d7">Cancel</a>
        </td>` : ""}
      </tr>
    </table>` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;border:1px solid #e8edf3">
        <tr><td style="padding:36px 36px 28px;text-align:center">
          <span style="display:inline-block;background:#001b35;color:#fff;font-size:11px;font-weight:800;padding:5px 14px;border-radius:9999px;text-transform:uppercase;letter-spacing:.5px">Reminder &bull; ${whenText}</span>
          <h1 style="font-size:22px;font-weight:800;color:#001b35;margin:16px 0 6px;line-height:1.3">${title}</h1>
          <p style="font-size:14px;color:#73777f;margin:0;line-height:1.5">Hi ${name}, your meeting with ward leadership is coming up in ${whenText}.</p>
        </td></tr>
        <tr><td style="padding:0 36px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #edf2f7">
            <tr><td style="padding:6px 20px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${detailRow("Date", formattedDate)}
                ${detailRow("Time", formattedTime)}
                ${detailRow("Location", location)}
                ${notes ? detailRow("Notes", notes).replace('border-bottom:1px solid #ebf2f8;', '') : ""}
              </table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:28px 36px 8px">
          <a href="${gcalUrl}" target="_blank" style="display:block;text-align:center;background:#fed000;color:#231b00;font-weight:700;font-size:15px;padding:14px 20px;border-radius:12px;text-decoration:none">Add to Google Calendar</a>
          ${buttons}
        </td></tr>
        <tr><td style="padding:24px 36px 36px;text-align:center;border-top:1px solid #f0f3f7;margin-top:8px">
          <p style="font-size:12px;color:#9a9ea6;line-height:1.6;margin:20px 0 0">Provo YSA 8th Ward &bull; Bishopric Interview Portal</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

function renderCancellationHtml({ name, title, formattedDate, formattedTime, rescheduleUrl }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f8fb;margin:0;padding:24px}
  .card{max-width:560px;margin:0 auto;background:#fff;border-radius:20px;padding:32px;text-align:center;box-shadow:0 8px 30px rgba(0,27,53,.06)}
  .badge{display:inline-block;background:#ba1a1a;color:#fff;font-size:11px;font-weight:800;padding:4px 12px;border-radius:9999px;text-transform:uppercase}
  </style></head><body><div class="card">
  <span class="badge">Appointment Cancelled</span>
  <h1 style="font-size:22px;font-weight:800;color:#001b35;margin:12px 0 4px">${title} Cancelled</h1>
  <p style="color:#73777f;font-size:14px">Hi ${name}, your appointment on ${formattedDate} at ${formattedTime} has been cancelled.</p>
  <a href="${rescheduleUrl || "https://provo8ward.vercel.app/#schedule"}" style="display:inline-block;background:#fed000;color:#231b00;font-weight:700;font-size:14px;padding:10px 24px;border-radius:12px;text-decoration:none;margin-top:16px">Book New Appointment</a>
  </div></body></html>`;
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  transporter,
  renderConfirmationHtml,
  renderReminderHtml,
  renderCancellationHtml,
  signAdminPayload,
  verifyAdminToken,
};
