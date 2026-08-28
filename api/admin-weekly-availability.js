// api/admin-weekly-availability.js
// Vercel Serverless Function — edits the recurring weekly availability
// windows. full_access only. Reading stays public (anon key, RLS
// SELECT-only) since the booking wizard needs it without login.

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
    if (action === "delete_day") {
      const { day_of_week } = req.body;
      if (typeof day_of_week !== "number") return res.status(400).json({ error: "Missing day_of_week." });

      const delRes = await supabaseServiceFetch(`weekly_availability?day_of_week=eq.${day_of_week}`, { method: "DELETE" });
      if (!delRes.ok) throw new Error(await delRes.text());
      return res.status(200).json({ success: true });
    }

    if (action === "delete_slot") {
      const { id, day_of_week, start_time } = req.body;
      const path = id
        ? `weekly_availability?id=eq.${encodeURIComponent(id)}`
        : `weekly_availability?day_of_week=eq.${day_of_week}&start_time=eq.${encodeURIComponent(start_time)}`;

      const delRes = await supabaseServiceFetch(path, { method: "DELETE" });
      if (!delRes.ok) throw new Error(await delRes.text());
      return res.status(200).json({ success: true });
    }

    if (action === "replace_all") {
      const { slots } = req.body;
      if (!Array.isArray(slots)) return res.status(400).json({ error: "Missing slots array." });

      const delRes = await supabaseServiceFetch("weekly_availability?id=neq.00000000-0000-0000-0000-000000000000", { method: "DELETE" });
      if (!delRes.ok) throw new Error(await delRes.text());

      if (slots.length > 0) {
        const payload = slots.map((s) => ({ day_of_week: s.day_of_week, start_time: s.start_time, end_time: s.end_time }));
        const insertRes = await supabaseServiceFetch("weekly_availability", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (!insertRes.ok) throw new Error(await insertRes.text());
      }

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    console.error("admin-weekly-availability error:", err);
    return res.status(500).json({ error: "Failed to save weekly availability." });
  }
};
