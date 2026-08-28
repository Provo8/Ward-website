// api/cancel-appointment.js
// Vercel Serverless Function — self-service cancellation link clicked from
// the confirmation email. Verifies the appointment's cancel_token, marks it
// cancelled in Supabase, emails a cancellation notice, and shows a result page.

const { supabaseServiceFetch, transporter, renderCancellationHtml, renderMessagePage: messagePage, sendAdminPush } = require("./_lib");
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

    try {
      await sendAdminPush({
        title: "Appointment Cancelled",
        body: `${appt.attendee_name} — ${title} on ${formattedDate} at ${formattedTime}`,
        url: "/#admin-scheduling",
      });
    } catch (pushErr) {
      console.warn("cancel-appointment: failed to push-notify admins", pushErr);
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
