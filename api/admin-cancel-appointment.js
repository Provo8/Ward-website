// api/admin-cancel-appointment.js
// Vercel Serverless Function — admin dashboard "cancel/delete appointment"
// action. full_access only.

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
    return res.status(400).json({ error: "Missing appointment id." });
  }

  try {
    const deleteRes = await supabaseServiceFetch(`appointments?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

    if (!deleteRes.ok) {
      console.error("admin-cancel-appointment: Supabase error", await deleteRes.text());
      return res.status(500).json({ error: "Failed to cancel appointment." });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("admin-cancel-appointment error:", err);
    return res.status(500).json({ error: "Failed to cancel appointment." });
  }
};
