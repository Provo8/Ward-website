// api/admin-login.js
// Vercel Serverless Function — verifies an admin's email + password against
// the admin_users table and returns a signed, time-limited session token.
// The token carries { sub, role, exp } but the role is a UI hint only —
// every privileged endpoint re-checks the account's current role via
// requireAdmin() in api/_lib.js, so a deleted/demoted admin loses access
// on their next request rather than at token expiry.

const { supabaseServiceFetch, verifyPassword, signAdminPayload } = require("./_lib");

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ADMIN_SESSION_SECRET) {
    console.error("Missing ADMIN_SESSION_SECRET env var");
    return res.status(500).json({ error: "Admin login is not configured." });
  }

  const { email, password } = req.body || {};
  if (!email || !password || typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Missing email or password." });
  }

  // Same generic error for "no such account" and "wrong password" so a
  // failed attempt never reveals whether an email is registered.
  const genericError = () => res.status(401).json({ success: false, error: "Incorrect email or password." });

  try {
    const lookupRes = await supabaseServiceFetch(
      `admin_users?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=id,email,password_hash,role`
    );
    if (!lookupRes.ok) {
      console.error("admin-login: Supabase lookup failed", await lookupRes.text());
      return res.status(500).json({ error: "Something went wrong. Please try again." });
    }

    const rows = await lookupRes.json();
    const admin = Array.isArray(rows) ? rows[0] : null;
    if (!admin) return genericError();

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
  } catch (err) {
    console.error("admin-login error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
