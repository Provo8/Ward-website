// api/_lib.js
// Shared config, Gmail transporter, and email templates for the
// send-email and cancel-appointment Vercel functions.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });

const crypto = require("crypto");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const webpush = require("web-push");

const MAP_URL = "https://maps.app.goo.gl/3o6eNeNcZVWrcdbU9";

const SUPABASE_URL = "https://dvsuzohrgbrwkgzsylbp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2c3V6b2hyZ2Jyd2tnenN5bGJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2OTAwOTUsImV4cCI6MjEwMzI2NjA5NX0.qXRW92s1BaiAT3uPGWBxe-UnMEPLYJamYs-JtyCJNR8";

// Server-only — never hardcoded and never sent to the client. Bypasses RLS,
// so this is the only key allowed to touch admin-only tables/columns.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Convenience wrapper for authenticated (service-role) Supabase REST calls.
function supabaseServiceFetch(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// ── Admin passwords ────────────────────────────────────────────────
function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// ── Admin session tokens ──────────────────────────────────────────
// Signed with a dedicated, rotatable secret (never a user's own password)
// so a token can only have been issued by api/admin-login.js after a real
// admin account's credentials were verified.
function signAdminPayload(payloadB64) {
  return crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(payloadB64).digest("hex");
}

// Verifies signature + expiry only. Returns the decoded { sub, role, exp }
// payload, or null if invalid/expired. The embedded `role` is a fast UI
// hint ONLY — callers that need to authorize an action must use
// requireAdmin() below, which re-checks the account's *current* role and
// existence against the database, so a deleted/demoted admin loses access
// on their very next request instead of waiting out the token's lifetime.
function verifyAdminToken(token) {
  if (!token || typeof token !== "string" || !process.env.ADMIN_SESSION_SECRET) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  const expected = signAdminPayload(payloadB64);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (typeof payload.sub !== "string" || typeof payload.role !== "string") return null;
    if (typeof payload.exp !== "number" || Date.now() >= payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// Verifies the token, then confirms (fresh DB lookup, service-role key)
// that the account still exists and — if `role` is given — that its
// CURRENT role satisfies the requirement. `role` may be a single role
// string or an array of allowed roles. Every admin-mutating endpoint
// should gate on this rather than verifyAdminToken() alone.
async function requireAdmin(req, { role } = {}) {
  const token = req.body && req.body.token;
  const payload = verifyAdminToken(token);
  if (!payload) return { ok: false, status: 401, error: "Unauthorized" };

  const res = await supabaseServiceFetch(`admin_users?id=eq.${encodeURIComponent(payload.sub)}&select=id,email,role`);
  if (!res.ok) return { ok: false, status: 500, error: "Failed to verify admin session." };

  const rows = await res.json();
  const admin = Array.isArray(rows) ? rows[0] : null;
  if (!admin) return { ok: false, status: 401, error: "Session no longer valid." };

  if (role) {
    const allowedRoles = Array.isArray(role) ? role : [role];
    if (!allowedRoles.includes(admin.role)) {
      return { ok: false, status: 403, error: "Forbidden" };
    }
  }

  return { ok: true, admin };
}

// Shared role → label mapping, used server-side for invite emails and
// client-side (scheduling-admin.js keeps its own copy in the browser).
const ADMIN_ROLE_LABELS = {
  full_access: "Full Access",
  scheduling_access: "Scheduling",
  announcements_only: "Announcements Only",
};

// ── Admin push notifications ───────────────────────────────────────
// Shared by api/notify-admins.js (new bookings) and any other endpoint
// that needs to alert every subscribed admin device (e.g. cancellations).
async function sendAdminPush({ title, body, url }) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.error("sendAdminPush: missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars");
    return { sent: 0, total: 0 };
  }

  webpush.setVapidDetails(
    "mailto:bpickard38@gmail.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const subsRes = await supabaseServiceFetch("admin_push_subscriptions?select=*");
  if (!subsRes.ok) throw new Error(`Failed to load subscriptions: ${subsRes.status}`);
  const subs = await subsRes.json();

  const payload = JSON.stringify({ title, body, url: url || "/#admin-scheduling" });

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush
        .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        .catch((err) => {
          // 404/410 means the browser unsubscribed or the endpoint expired
          if (err.statusCode === 404 || err.statusCode === 410) {
            return supabaseServiceFetch(`admin_push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, {
              method: "DELETE",
            });
          }
          throw err;
        })
    )
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  return { sent, total: subs.length };
}

function renderConfirmationHtml({ name, title, formattedDate, formattedTime, location, notes, gcalUrl, cancelUrl, rescheduleUrl }) {
  const detailRow = (label, value) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #ebf2f8;font-size:11px;font-weight:700;color:#8b8f98;text-transform:uppercase;letter-spacing:.4px;vertical-align:top;width:92px">${label}</td>
      <td style="padding:12px 0;border-bottom:1px solid #ebf2f8;font-size:14px;font-weight:600;color:#001b35;vertical-align:top">${value}</td>
    </tr>`;
  const locationHtml = `<a href="${MAP_URL}" target="_blank" style="color:#001b35;text-decoration:underline">${location}</a>`;

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
                ${detailRow("Location", locationHtml)}
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
  const locationHtml = `<a href="${MAP_URL}" target="_blank" style="color:#001b35;text-decoration:underline">${location}</a>`;

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
                ${detailRow("Location", locationHtml)}
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

function renderAdminInviteHtml({ role, inviteUrl }) {
  const roleLabel = ADMIN_ROLE_LABELS[role] || role;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f8fb;margin:0;padding:24px}
  .card{max-width:480px;margin:0 auto;background:#fff;border-radius:20px;padding:32px;text-align:center;box-shadow:0 8px 30px rgba(0,27,53,.06)}
  .badge{display:inline-block;background:#fed000;color:#231b00;font-size:11px;font-weight:800;padding:4px 12px;border-radius:9999px;text-transform:uppercase}
  </style></head><body><div class="card">
  <span class="badge">Admin Invite</span>
  <h1 style="font-size:22px;font-weight:800;color:#001b35;margin:12px 0 4px">You've been added as an admin</h1>
  <p style="color:#73777f;font-size:14px;line-height:1.6">You've been invited to the Provo YSA 8th Ward leadership portal with <strong>${roleLabel}</strong> access. Set your password to finish setting up your account.</p>
  <a href="${inviteUrl}" style="display:inline-block;background:#fed000;color:#231b00;font-weight:700;font-size:14px;padding:12px 28px;border-radius:12px;text-decoration:none;margin-top:16px">Set Your Password</a>
  <p style="color:#9a9ea6;font-size:12px;margin-top:20px">This link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
  </div></body></html>`;
}

function renderMessagePage(heading, message, origin, { linkUrl, linkText } = {}) {
  const href = linkUrl || (origin ? `${origin}/#schedule` : null);
  const text = linkText || "Go to Scheduling Page";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f8fb;margin:0;padding:24px;display:flex;min-height:100vh;align-items:center;justify-content:center}
    .card{max-width:440px;width:100%;background:#fff;border-radius:20px;padding:36px 28px;text-align:center;box-shadow:0 8px 30px rgba(0,27,53,.08);border:1px solid #ebf2f8}
    h1{font-size:20px;font-weight:800;color:#001b35;margin:0 0 10px}
    p{color:#73777f;font-size:14px;line-height:1.6;margin:0}
    a.btn{display:inline-block;margin-top:20px;background:#fed000;color:#231b00;font-weight:700;font-size:14px;padding:12px 24px;border-radius:12px;text-decoration:none}
  </style></head><body><div class="card">
  <h1>${heading}</h1>
  <p>${message}</p>
  ${href ? `<a class="btn" href="${href}">${text}</a>` : ""}
  </div></body></html>`;
}

function renderSetPasswordFormPage({ email, inviteToken, error }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f8fb;margin:0;padding:24px;display:flex;min-height:100vh;align-items:center;justify-content:center}
    .card{max-width:400px;width:100%;background:#fff;border-radius:20px;padding:32px 28px;box-shadow:0 8px 30px rgba(0,27,53,.08);border:1px solid #ebf2f8}
    h1{font-size:20px;font-weight:800;color:#001b35;margin:0 0 6px;text-align:center}
    p.sub{color:#73777f;font-size:13px;margin:0 0 20px;text-align:center}
    label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#8b8f98;margin-bottom:6px}
    input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;border:1px solid #dfe4ea;font-size:14px;margin-bottom:16px}
    button{width:100%;background:#fed000;color:#231b00;font-weight:700;font-size:14px;padding:13px;border-radius:12px;border:none;cursor:pointer}
    .error{background:#fdecea;color:#ba1a1a;font-size:13px;padding:10px 14px;border-radius:10px;margin-bottom:16px}
  </style></head><body><div class="card">
  <h1>Set Your Password</h1>
  <p class="sub">${email}</p>
  ${error ? `<div class="error">${error}</div>` : ""}
  <form method="POST">
    <input type="hidden" name="invite_token" value="${inviteToken}">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" minlength="8" required autofocus>
    <label for="confirm_password">Confirm Password</label>
    <input id="confirm_password" name="confirm_password" type="password" minlength="8" required>
    <button type="submit">Set Password &amp; Activate Account</button>
  </form>
  </div></body></html>`;
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  supabaseServiceFetch,
  transporter,
  renderConfirmationHtml,
  renderReminderHtml,
  renderCancellationHtml,
  renderAdminInviteHtml,
  renderMessagePage,
  renderSetPasswordFormPage,
  hashPassword,
  verifyPassword,
  signAdminPayload,
  verifyAdminToken,
  requireAdmin,
  sendAdminPush,
  ADMIN_ROLE_LABELS,
};
