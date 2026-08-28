// api/appointments-admin-feed.js
// Vercel Serverless Function — returns full appointment records (including
// attendee PII) for the admin dashboard feed. full_access only. The public
// booking wizard instead reads a non-PII column subset directly via the
// anon key (see scheduling-admin.js refreshAppointmentsFromSupabase()).

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
    const listRes = await supabaseServiceFetch("appointments?select=*,meeting_types(title)&order=start_time.asc");
    if (!listRes.ok) {
      console.error("appointments-admin-feed: Supabase error", await listRes.text());
      return res.status(500).json({ error: "Failed to load appointments." });
    }
    const appointments = await listRes.json();
    return res.status(200).json({ success: true, appointments });
  } catch (err) {
    console.error("appointments-admin-feed error:", err);
    return res.status(500).json({ error: "Failed to load appointments." });
  }
};
