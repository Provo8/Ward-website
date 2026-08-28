// api/admin-users.js
// Vercel Serverless Function — list/create/delete admin accounts, dispatched
// by `action`. Combined into one route (was 3 separate files) to stay under
// Vercel's per-deployment serverless function limit on the Hobby plan.
// full_access only.

const crypto = require("crypto");
const { supabaseServiceFetch, requireAdmin, transporter, renderAdminInviteHtml } = require("./_lib");

const VALID_ROLES = ["full_access", "scheduling_access", "announcements_only"];
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function handleList(req, res) {
  const listRes = await supabaseServiceFetch("admin_users?select=id,email,role,created_at,password_hash&order=created_at.asc");
  if (!listRes.ok) throw new Error(await listRes.text());
  const rows = await listRes.json();
  // Never send password_hash to the client — only whether it's set, so the
  // UI can show a "Pending" badge for admins who haven't accepted their invite.
  const admins = rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    created_at: r.created_at,
    status: r.password_hash ? "active" : "pending",
  }));
  return res.status(200).json({ success: true, admins });
}

// Creates an invited (pending) admin — no password is set here; the
// invitee sets their own via the emailed link (api/admin-login.js handles
// both showing that form and processing it). Re-inviting an email that's
// still pending regenerates the invite instead of erroring, so a lost
// invite email can just be resent by creating the same admin again.
async function handleCreate(req, res) {
  const { email, role } = req.body;
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Please provide a valid email address." });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Please select a valid permission level." });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existingRes = await supabaseServiceFetch(`admin_users?email=eq.${encodeURIComponent(normalizedEmail)}&select=id,password_hash`);
  const existing = existingRes.ok ? await existingRes.json() : [];
  const existingAdmin = Array.isArray(existing) ? existing[0] : null;
  if (existingAdmin && existingAdmin.password_hash) {
    return res.status(409).json({ error: "An admin with that email already exists." });
  }

  const invite_token = crypto.randomUUID();
  const invite_expires_at = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  let admin;
  if (existingAdmin) {
    // Still-pending invite for this email — resend/refresh it.
    const updateRes = await supabaseServiceFetch(`admin_users?id=eq.${existingAdmin.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ role, invite_token, invite_expires_at }),
    });
    if (!updateRes.ok) throw new Error(await updateRes.text());
    const updated = await updateRes.json();
    admin = Array.isArray(updated) ? updated[0] : updated;
  } else {
    const createRes = await supabaseServiceFetch("admin_users", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([{ email: normalizedEmail, password_hash: null, role, invite_token, invite_expires_at }]),
    });
    if (!createRes.ok) throw new Error(await createRes.text());
    const created = await createRes.json();
    admin = Array.isArray(created) ? created[0] : created;
  }

  const origin = `https://${req.headers.host}`;
  const inviteUrl = `${origin}/api/admin-login?invite=${invite_token}`;

  let emailSent = false;
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    try {
      await transporter.sendMail({
        from: `"Provo YSA 8th Ward" <${process.env.GMAIL_USER}>`,
        to: admin.email,
        subject: "You've been added as a ward website admin",
        html: renderAdminInviteHtml({ role: admin.role, inviteUrl }),
      });
      emailSent = true;
    } catch (mailErr) {
      console.warn("admin-users create: failed to send invite email", mailErr);
    }
  }

  return res.status(200).json({
    success: true,
    admin: { id: admin.id, email: admin.email, role: admin.role, created_at: admin.created_at, status: "pending" },
    emailSent,
    // Included so the inviting admin can share it manually if the email
    // failed to send (e.g. GMAIL_* env vars missing) — safe to expose since
    // only a full_access admin can reach this endpoint.
    inviteUrl,
  });
}

// Changes an existing admin's permission level. Email/password are
// untouched — this only ever writes `role`.
async function handleUpdate(req, res) {
  const { id, role } = req.body;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing admin id." });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "Please select a valid permission level." });
  }

  const targetRes = await supabaseServiceFetch(`admin_users?id=eq.${encodeURIComponent(id)}&select=id,role`);
  const targetRows = targetRes.ok ? await targetRes.json() : [];
  const target = Array.isArray(targetRows) ? targetRows[0] : null;
  if (!target) return res.status(404).json({ error: "Admin not found." });

  if (target.role === "full_access" && role !== "full_access") {
    const countRes = await supabaseServiceFetch(`admin_users?role=eq.full_access&select=id`);
    const fullAccessAdmins = countRes.ok ? await countRes.json() : [];
    if (Array.isArray(fullAccessAdmins) && fullAccessAdmins.length <= 1) {
      return res.status(400).json({ error: "Can't change the last full-access admin's role." });
    }
  }

  const updateRes = await supabaseServiceFetch(`admin_users?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
  if (!updateRes.ok) throw new Error(await updateRes.text());

  return res.status(200).json({ success: true });
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

const ACTION_HANDLERS = { list: handleList, create: handleCreate, update: handleUpdate, delete: handleDelete };

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
