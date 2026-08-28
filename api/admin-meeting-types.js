// api/admin-meeting-types.js
// Vercel Serverless Function — create/update/toggle/delete meeting types.
// full_access only. Reading meeting types stays public (anon key, RLS
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

  const { action, id } = req.body || {};

  try {
    if (action === "create") {
      const { title, description, duration_minutes, buffer_minutes, assigned_to, is_active } = req.body;
      if (!title) return res.status(400).json({ error: "Title is required." });

      const createRes = await supabaseServiceFetch("meeting_types", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{ title, description, duration_minutes, buffer_minutes, assigned_to, is_active }]),
      });
      if (!createRes.ok) throw new Error(await createRes.text());
      const created = await createRes.json();
      return res.status(200).json({ success: true, meeting_type: Array.isArray(created) ? created[0] : created });
    }

    if (action === "update") {
      if (!id) return res.status(400).json({ error: "Missing meeting type id." });
      const { title, description, duration_minutes, buffer_minutes, assigned_to, is_active } = req.body;

      const updateRes = await supabaseServiceFetch(`meeting_types?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ title, description, duration_minutes, buffer_minutes, assigned_to, is_active }),
      });
      if (!updateRes.ok) throw new Error(await updateRes.text());
      return res.status(200).json({ success: true });
    }

    if (action === "toggle_active") {
      if (!id) return res.status(400).json({ error: "Missing meeting type id." });
      const { is_active } = req.body;

      const toggleRes = await supabaseServiceFetch(`meeting_types?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: Boolean(is_active) }),
      });
      if (!toggleRes.ok) throw new Error(await toggleRes.text());
      return res.status(200).json({ success: true });
    }

    if (action === "delete") {
      if (!id) return res.status(400).json({ error: "Missing meeting type id." });

      const deleteRes = await supabaseServiceFetch(`meeting_types?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!deleteRes.ok) throw new Error(await deleteRes.text());
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    console.error("admin-meeting-types error:", err);
    return res.status(500).json({ error: "Failed to save meeting type." });
  }
};
