// api/reschedule-appointment.js
// Vercel Serverless Function — public self-service reschedule (from the
// booking wizard's "reschedule" flow, or the emailed cancel/reschedule
// link). No admin login required — ownership is proven by the caller
// supplying the appointment's cancel_token (mirrors the check already used
// by api/cancel-appointment.js), verified here in application code since
// RLS can't express "matches a secret from the request body."

const { supabaseServiceFetch } = require("./_lib");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    id,
    cancel_token,
    meeting_type_id,
    attendee_name,
    attendee_email,
    attendee_phone,
    notes,
    start_time,
    end_time,
  } = req.body || {};

  if (!id || !cancel_token || !attendee_name || !attendee_email || !start_time || !end_time) {
    return res.status(400).json({ error: "Missing required appointment fields." });
  }

  try {
    const lookupRes = await supabaseServiceFetch(`appointments?id=eq.${encodeURIComponent(id)}&select=cancel_token`);
    if (!lookupRes.ok) {
      console.error("reschedule-appointment: Supabase lookup failed", await lookupRes.text());
      return res.status(500).json({ error: "Failed to reschedule appointment." });
    }

    const rows = await lookupRes.json();
    const existing = Array.isArray(rows) ? rows[0] : null;
    if (!existing) return res.status(404).json({ error: "Appointment not found." });
    if (String(existing.cancel_token) !== String(cancel_token)) {
      return res.status(403).json({ error: "Invalid reschedule link." });
    }

    const patchPayload = {
      attendee_name,
      attendee_email,
      attendee_phone: attendee_phone || null,
      notes: notes || null,
      start_time,
      end_time,
      status: "confirmed",
      // A rescheduled appointment needs fresh 24h/30m reminders for its
      // new time instead of being skipped as "already sent" for the old one.
      reminder_24h_sent_at: null,
      reminder_30m_sent_at: null,
    };
    if (meeting_type_id) patchPayload.meeting_type_id = meeting_type_id;

    const patchRes = await supabaseServiceFetch(`appointments?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patchPayload),
    });

    if (!patchRes.ok) {
      const errText = await patchRes.text();
      console.error("reschedule-appointment: Supabase update failed", errText);
      const isConflict = /overlap|exclu/i.test(errText);
      return res.status(isConflict ? 409 : 500).json({
        error: isConflict ? "That time was just booked by someone else. Please choose another slot." : "Failed to reschedule appointment.",
      });
    }

    const updated = await patchRes.json();
    return res.status(200).json({ success: true, appointment: Array.isArray(updated) ? updated[0] : updated });
  } catch (err) {
    console.error("reschedule-appointment error:", err);
    return res.status(500).json({ error: "Failed to reschedule appointment." });
  }
};
