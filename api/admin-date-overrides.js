// api/admin-date-overrides.js
// Vercel Serverless Function — create/replace/delete a specific-date
// availability override (block a day, or set special hours). full_access
// only. Reading stays public (anon key, RLS SELECT-only).

const { supabaseServiceFetch, requireAdmin } = require("./_lib");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireAdmin(req, { role: "full_access" });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { action } = req.body || {};

  try {
    if (action === "save") {
      const { override_date, is_unavailable, start_time, end_time } = req.body;
      if (!override_date) return res.status(400).json({ error: "Missing override_date." });

      const delRes = await supabaseServiceFetch(`date_overrides?override_date=eq.${encodeURIComponent(override_date)}`, { method: "DELETE" });
      if (!delRes.ok) throw new Error(await delRes.text());

      const insertRes = await supabaseServiceFetch("date_overrides", {
        method: "POST",
        body: JSON.stringify([{
          override_date,
          is_unavailable: Boolean(is_unavailable),
          start_time: is_unavailable ? null : start_time,
          end_time: is_unavailable ? null : end_time,
        }]),
      });
      if (!insertRes.ok) throw new Error(await insertRes.text());

      return res.status(200).json({ success: true });
    }

    if (action === "delete") {
      const { id, override_date } = req.body;
      if (id) {
        const delRes = await supabaseServiceFetch(`date_overrides?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!delRes.ok) throw new Error(await delRes.text());
      }
      if (override_date) {
        const delRes = await supabaseServiceFetch(`date_overrides?override_date=eq.${encodeURIComponent(override_date)}`, { method: "DELETE" });
        if (!delRes.ok) throw new Error(await delRes.text());
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    console.error("admin-date-overrides error:", err);
    return res.status(500).json({ error: "Failed to save date override." });
  }
};
