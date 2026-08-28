// api/admin-users-list.js
// Vercel Serverless Function — lists admin accounts for the "Admins"
// management tab. full_access only.

const { supabaseServiceFetch, requireAdmin } = require("./_lib");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireAdmin(req, { role: "full_access" });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const listRes = await supabaseServiceFetch("admin_users?select=id,email,role,created_at&order=created_at.asc");
    if (!listRes.ok) {
      console.error("admin-users-list: Supabase error", await listRes.text());
      return res.status(500).json({ error: "Failed to load admins." });
    }
    const admins = await listRes.json();
    return res.status(200).json({ success: true, admins });
  } catch (err) {
    console.error("admin-users-list error:", err);
    return res.status(500).json({ error: "Failed to load admins." });
  }
};
