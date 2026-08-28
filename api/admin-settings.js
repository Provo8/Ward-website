// api/admin-settings.js
// Vercel Serverless Function — updates ward_scheduling_settings (currently
// just the "accepting appointments" toggle). full_access only. Reading
// stays public (anon key, RLS SELECT-only) since the booking wizard needs
// it without login.

const { supabaseServiceFetch, requireAdmin } = require("./_lib");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireAdmin(req, { role: "full_access" });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { id, accepting_appointments } = req.body || {};
  if (!id) return res.status(400).json({ error: "Missing settings id." });

  try {
    const updateRes = await supabaseServiceFetch(`ward_scheduling_settings?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ accepting_appointments: Boolean(accepting_appointments) }),
    });
    if (!updateRes.ok) throw new Error(await updateRes.text());
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("admin-settings error:", err);
    return res.status(500).json({ error: "Failed to save settings." });
  }
};
