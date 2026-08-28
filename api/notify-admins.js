// api/notify-admins.js
// Sends a Web Push notification to every subscribed admin device when a
// new appointment is booked (or rescheduled) through the public booking flow.

const { sendAdminPush } = require("./_lib");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { appointment } = req.body || {};
  if (!appointment || !appointment.attendee_name) {
    return res.status(400).json({ error: "Missing appointment." });
  }

  const title = appointment.meeting_type_title || "Bishopric Interview";
  const startDate = appointment.start_time ? new Date(appointment.start_time) : null;
  const timeText = startDate
    ? startDate.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZone: "America/Denver",
      })
    : "";

  try {
    const { sent, total } = await sendAdminPush({
      title: "New Appointment Booked",
      body: `${appointment.attendee_name} — ${title}${timeText ? ` on ${timeText}` : ""}`,
      url: "/#admin-scheduling",
    });
    return res.status(200).json({ success: true, sent, total });
  } catch (err) {
    console.error("notify-admins error:", err);
    return res.status(500).json({ error: "Failed to notify admins." });
  }
};
