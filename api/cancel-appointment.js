// api/cancel-appointment.js
// Vercel Serverless Function — self-service cancellation link clicked from
// the confirmation email. Verifies the appointment's cancel_token, marks it
// cancelled in Supabase, emails a cancellation notice, and shows a result page.

const { supabaseServiceFetch, transporter, renderCancellationHtml } = require("./_lib");
const { deleteCalendarEvent } = require("./_googleCalendar");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (req.method !== "GET") {
    return res.status(405).send(messagePage("Method Not Allowed", "This link only supports GET requests."));
  }

  const { id, token } = req.query;
  if (!id || !token) {
    return res.status(400).send(messagePage("Invalid Link", "This cancellation link is missing required information."));
  }

  const origin = `https://${req.headers.host}`;

  try {
    const getRes = await supabaseServiceFetch(`appointments?id=eq.${encodeURIComponent(id)}&select=*,meeting_types(title)`);
    const rows = await getRes.json();
    const appt = Array.isArray(rows) ? rows[0] : null;

    if (!appt) {
      return res.status(404).send(messagePage("Appointment Not Found", "We couldn't find this appointment. It may have already been removed.", origin));
    }
    if (String(appt.cancel_token) !== String(token)) {
      return res.status(403).send(messagePage("Invalid Link", "This cancellation link is not valid.", origin));
    }

    const title = (appt.meeting_types && appt.meeting_types.title) || "Appointment";
    const startDate = new Date(appt.start_time);
    const endDate = new Date(appt.end_time);
    const formattedDate = startDate.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
      timeZone: "America/Denver",
    });
    const formatTime = (d) => d.toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Denver",
    });
    const formattedTime = `${formatTime(startDate)} – ${formatTime(endDate)} (MST)`;

    if (appt.status === "cancelled") {
      return res.status(200).send(messagePage("Already Cancelled", `This appointment on ${formattedDate} at ${formattedTime} has already been cancelled.`, origin));
    }

    const patchRes = await supabaseServiceFetch(`appointments?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "cancelled" }),
    });

    if (!patchRes.ok) {
      console.error("cancel-appointment: Supabase update failed", await patchRes.text());
      return res.status(500).send(messagePage("Something Went Wrong", "We couldn't cancel your appointment. Please try again or contact the ward.", origin));
    }

    try {
      await deleteCalendarEvent(appt.google_event_id);
    } catch (calErr) {
      console.warn("cancel-appointment: failed to remove Google Calendar event", calErr);
    }

    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD && appt.attendee_email) {
      try {
        const cancelHtml = renderCancellationHtml({
          name: appt.attendee_name,
          title,
          formattedDate,
          formattedTime,
          rescheduleUrl: `${origin}/#schedule`,
        });
        await transporter.sendMail({
          from: `"Provo YSA 8th Ward" <${process.env.GMAIL_USER}>`,
          to: appt.attendee_email,
          subject: `Cancelled: ${title} – Provo YSA 8th Ward`,
          html: cancelHtml,
        });
      } catch (mailErr) {
        console.warn("cancel-appointment: failed to send cancellation email", mailErr);
      }
    }

    return res.status(200).send(messagePage("Appointment Cancelled", `Your appointment on ${formattedDate} at ${formattedTime} has been cancelled. A confirmation email has been sent.`, origin));
  } catch (err) {
    console.error("cancel-appointment error:", err);
    return res.status(500).send(messagePage("Something Went Wrong", "We couldn't process your request. Please try again later.", origin));
  }
};

function messagePage(heading, message, origin) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f8fb;margin:0;padding:24px;display:flex;min-height:100vh;align-items:center;justify-content:center}
    .card{max-width:440px;width:100%;background:#fff;border-radius:20px;padding:36px 28px;text-align:center;box-shadow:0 8px 30px rgba(0,27,53,.08);border:1px solid #ebf2f8}
    h1{font-size:20px;font-weight:800;color:#001b35;margin:0 0 10px}
    p{color:#73777f;font-size:14px;line-height:1.6;margin:0}
    a.btn{display:inline-block;margin-top:20px;background:#fed000;color:#231b00;font-weight:700;font-size:14px;padding:12px 24px;border-radius:12px;text-decoration:none}
  </style></head><body><div class="card">
  <h1>${heading}</h1>
  <p>${message}</p>
  ${origin ? `<a class="btn" href="${origin}/#schedule">Go to Scheduling Page</a>` : ""}
  </div></body></html>`;
}
