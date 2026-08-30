// api/calendar-sync.js
// Vercel Serverless Function — mirrors a booked/rescheduled/cancelled
// appointment onto the bishop's personal Google Calendar. Called from the
// client the same way api/notify-admins.js is, right after an appointment
// is saved to (or removed from) Supabase. Best-effort: any failure here is
// logged but never blocks the booking/cancellation flow itself.

const { supabaseServiceFetch } = require("./_lib");
const { isConfigured, upsertCalendarEvent, deleteCalendarEvent } = require("./_googleCalendar");

const LOCATION = "Bishop's Office (Manavu Chapel, up the stairs) / Provo YSA 8th Ward";

async function patchGoogleEventId(id, googleEventId) {
  await supabaseServiceFetch(`appointments?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ google_event_id: googleEventId }),
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!isConfigured()) {
    return res.status(200).json({ success: false, skipped: true, reason: "Google Calendar sync not configured." });
  }

  const { action, appointment } = req.body || {};
  if (!appointment || !appointment.start_time || !appointment.end_time) {
    return res.status(400).json({ error: "Missing appointment." });
  }

  try {
    if (action === "delete") {
      await deleteCalendarEvent(appointment.google_event_id);
      return res.status(200).json({ success: true, action: "delete" });
    }

    const googleEventId = await upsertCalendarEvent({
      ...appointment,
      title: appointment.meeting_type_title || "Bishopric Interview",
      location: LOCATION,
    });

    if (googleEventId && appointment.id && googleEventId !== appointment.google_event_id) {
      await patchGoogleEventId(appointment.id, googleEventId);
    }

    return res.status(200).json({ success: true, action: "upsert", google_event_id: googleEventId });
  } catch (err) {
    console.error("calendar-sync error:", err);
    return res.status(200).json({ success: false, error: err.message });
  }
};
