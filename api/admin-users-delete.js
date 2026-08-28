// api/admin-users-delete.js
// Vercel Serverless Function — removes an admin account, immediately
// revoking their access (their next request fails requireAdmin()'s fresh
// DB lookup, regardless of their token's remaining lifetime). full_access
// only. Refuses to delete the last remaining full_access admin so the ward
// can't lock itself out of admin management.

const { supabaseServiceFetch, requireAdmin } = require("./_lib");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireAdmin(req, { role: "full_access" });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { id } = req.body || {};
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing admin id." });
  }

  try {
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

    const deleteRes = await supabaseServiceFetch(`admin_users?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

    if (!deleteRes.ok) {
      console.error("admin-users-delete: Supabase error", await deleteRes.text());
      return res.status(500).json({ error: "Failed to remove admin." });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("admin-users-delete error:", err);
    return res.status(500).json({ error: "Failed to remove admin." });
  }
};
