// api/admin-users.js
// Vercel Serverless Function — list/create/delete admin accounts, dispatched
// by `action`. Combined into one route (was 3 separate files) to stay under
// Vercel's per-deployment serverless function limit on the Hobby plan.
// full_access only.

const { supabaseServiceFetch, requireAdmin, hashPassword } = require("./_lib");

const VALID_ROLES = ["full_access", "announcements_only"];
const MIN_PASSWORD_LENGTH = 8;

async function handleList(req, res) {
  const listRes = await supabaseServiceFetch("admin_users?select=id,email,role,created_at&order=created_at.asc");
  if (!listRes.ok) throw new Error(await listRes.text());
  const admins = await listRes.json();
  return res.status(200).json({ success: true, admins });
}

async function handleCreate(req, res) {
  const { email, password, role } = req.body;
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Please provide a valid email address." });
  }
  if (!password || typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Please select a valid permission level." });
  }

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
  if (!createRes.ok) throw new Error(await createRes.text());

  const created = await createRes.json();
  const admin = Array.isArray(created) ? created[0] : created;
  return res.status(200).json({
    success: true,
    admin: { id: admin.id, email: admin.email, role: admin.role, created_at: admin.created_at },
  });
}

async function handleDelete(req, res) {
  const { id } = req.body;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing admin id." });
  }

  const targetRes = await supabaseServiceFetch(`admin_users?id=eq.${encodeURIComponent(id)}&select=id,role`);
  const targetRows = targetRes.ok ? await targetRes.json() : [];
  const target = Array.isArray(targetRows) ? targetRows[0] : null;
  if (!target) return res.status(404).json({ error: "Admin not found." });

  if (target.role === "full_access") {
    const countRes = await supabaseServiceFetch(`admin_users?role=eq.full_access&select=id`);
    const fullAccessAdmins = countRes.ok ? await countRes.json() : [];
    if (Array.isArray(fullAccessAdmins) && fullAccessAdmins.length <= 1) {
      return res.status(400).json({ error: "Can't remove the last full-access admin." });
    }
  }

  const deleteRes = await supabaseServiceFetch(`admin_users?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!deleteRes.ok) throw new Error(await deleteRes.text());

  return res.status(200).json({ success: true });
}

const ACTION_HANDLERS = { list: handleList, create: handleCreate, delete: handleDelete };

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireAdmin(req, { role: "full_access" });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { action } = req.body || {};
  const actionHandler = ACTION_HANDLERS[action];
  if (!actionHandler) return res.status(400).json({ error: "Unknown action." });

  try {
    return await actionHandler(req, res);
  } catch (err) {
    console.error(`admin-users (${action}) error:`, err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
