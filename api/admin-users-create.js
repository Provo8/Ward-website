// api/admin-users-create.js
// Vercel Serverless Function — creates a new admin account. full_access only.

const { supabaseServiceFetch, requireAdmin, hashPassword } = require("./_lib");

const VALID_ROLES = ["full_access", "announcements_only"];
const MIN_PASSWORD_LENGTH = 8;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireAdmin(req, { role: "full_access" });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { email, password, role } = req.body || {};
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Please provide a valid email address." });
  }
  if (!password || typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Please select a valid permission level." });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const existingRes = await supabaseServiceFetch(`admin_users?email=eq.${encodeURIComponent(normalizedEmail)}&select=id`);
    const existing = existingRes.ok ? await existingRes.json() : [];
    if (Array.isArray(existing) && existing.length > 0) {
      return res.status(409).json({ error: "An admin with that email already exists." });
    }

    const password_hash = await hashPassword(password);

    const createRes = await supabaseServiceFetch("admin_users", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([{ email: normalizedEmail, password_hash, role }]),
    });

    if (!createRes.ok) {
      console.error("admin-users-create: Supabase error", await createRes.text());
      return res.status(500).json({ error: "Failed to create admin." });
    }

    const created = await createRes.json();
    const admin = Array.isArray(created) ? created[0] : created;
    return res.status(200).json({
      success: true,
      admin: { id: admin.id, email: admin.email, role: admin.role, created_at: admin.created_at },
    });
  } catch (err) {
    console.error("admin-users-create error:", err);
    return res.status(500).json({ error: "Failed to create admin." });
  }
};
