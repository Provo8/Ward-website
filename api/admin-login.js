// api/admin-login.js
// Vercel Serverless Function — two things live here to stay under Vercel's
// per-deployment serverless function limit on the Hobby plan:
//
// 1. POST { email, password } (JSON) — the SPA's normal login, returns a
//    signed session token. The token carries { sub, role, exp } but the
//    role is a UI hint only — every privileged endpoint re-checks the
//    account's current role via requireAdmin() in api/_lib.js, so a
//    deleted/demoted admin loses access on their next request rather than
//    at token expiry.
//
// 2. The admin-invite flow, reached from the emailed invite link
//    (api/admin-users.js sends `${origin}/api/admin-login?invite=<token>`):
//    GET  ?invite=<token>           → serve a plain HTML "set password" form
//    POST { invite_token, password, confirm_password } (HTML form submit)
//                                    → verify the invite, set the password,
//                                      clear the invite fields, show a
//                                      plain HTML success/error page.

const {
  supabaseServiceFetch,
  verifyPassword,
  hashPassword,
  signAdminPayload,
  renderMessagePage,
  renderSetPasswordFormPage,
} = require("./_lib");

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_PASSWORD_LENGTH = 8;

async function handleInviteForm(req, res) {
  const inviteToken = req.query.invite;
  const origin = `https://${req.headers.host}`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const lookupRes = await supabaseServiceFetch(
    `admin_users?invite_token=eq.${encodeURIComponent(inviteToken)}&select=email,invite_expires_at`
  );
  const rows = lookupRes.ok ? await lookupRes.json() : [];
  const admin = Array.isArray(rows) ? rows[0] : null;

  if (!admin) {
    return res.status(404).send(renderMessagePage("Invalid Invite", "This invite link isn't valid. It may have already been used.", origin));
  }
  if (new Date(admin.invite_expires_at).getTime() < Date.now()) {
    return res.status(410).send(renderMessagePage("Invite Expired", "This invite link has expired. Ask a full-access admin to re-add you to resend it.", origin));
  }

  return res.status(200).send(renderSetPasswordFormPage({ email: admin.email, inviteToken }));
}

async function handleAcceptInvite(req, res) {
  const { invite_token, password, confirm_password } = req.body;
  const origin = `https://${req.headers.host}`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const lookupRes = await supabaseServiceFetch(
    `admin_users?invite_token=eq.${encodeURIComponent(invite_token)}&select=id,email,invite_expires_at`
  );
  const rows = lookupRes.ok ? await lookupRes.json() : [];
  const admin = Array.isArray(rows) ? rows[0] : null;

  if (!admin) {
    return res.status(404).send(renderMessagePage("Invalid Invite", "This invite link isn't valid. It may have already been used.", origin));
  }
  if (new Date(admin.invite_expires_at).getTime() < Date.now()) {
    return res.status(410).send(renderMessagePage("Invite Expired", "This invite link has expired. Ask a full-access admin to re-add you to resend it.", origin));
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH || password !== confirm_password) {
    return res.status(400).send(renderSetPasswordFormPage({
      email: admin.email,
      inviteToken: invite_token,
      error: password !== confirm_password ? "Passwords didn't match." : `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    }));
  }

  const password_hash = await hashPassword(password);
  const updateRes = await supabaseServiceFetch(`admin_users?id=eq.${admin.id}`, {
    method: "PATCH",
    body: JSON.stringify({ password_hash, invite_token: null, invite_expires_at: null }),
  });
  if (!updateRes.ok) {
    console.error("admin-login accept-invite: Supabase update failed", await updateRes.text());
    return res.status(500).send(renderMessagePage("Something Went Wrong", "We couldn't set your password. Please try the invite link again.", origin));
  }

  return res.status(200).send(renderMessagePage(
    "Password Set!",
    `Your account (${admin.email}) is ready. You can now sign in to the leadership portal.`,
    origin,
    { linkUrl: `${origin}/#admin-scheduling`, linkText: "Go to Admin Sign In" }
  ));
}

async function handlePasswordLogin(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Missing email or password." });
  }

  // Same generic error for "no such account", "wrong password", and
  // "invite not yet accepted" so a failed attempt never reveals which case applies.
  const genericError = () => res.status(401).json({ success: false, error: "Incorrect email or password." });

  const lookupRes = await supabaseServiceFetch(
    `admin_users?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=id,email,password_hash,role`
  );
  if (!lookupRes.ok) {
    console.error("admin-login: Supabase lookup failed", await lookupRes.text());
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }

  const rows = await lookupRes.json();
  const admin = Array.isArray(rows) ? rows[0] : null;
  if (!admin || !admin.password_hash) return genericError();

  const passwordMatches = await verifyPassword(password, admin.password_hash);
  if (!passwordMatches) return genericError();

  const payload = Buffer.from(
    JSON.stringify({ sub: admin.id, role: admin.role, exp: Date.now() + SESSION_TTL_MS })
  ).toString("base64url");
  const token = `${payload}.${signAdminPayload(payload)}`;

  return res.status(200).json({
    success: true,
    token,
    admin: { id: admin.id, email: admin.email, role: admin.role },
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (!process.env.ADMIN_SESSION_SECRET) {
    console.error("Missing ADMIN_SESSION_SECRET env var");
    return res.status(500).json({ error: "Admin login is not configured." });
  }

  try {
    if (req.method === "GET" && req.query.invite) {
      return await handleInviteForm(req, res);
    }
    if (req.method === "POST" && req.body && req.body.invite_token) {
      return await handleAcceptInvite(req, res);
    }
    if (req.method === "POST") {
      return await handlePasswordLogin(req, res);
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("admin-login error:", err);
    if (req.method === "GET" || (req.body && req.body.invite_token)) {
      return res.status(500).send(renderMessagePage("Something Went Wrong", "Please try again later.", `https://${req.headers.host}`));
    }
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
