// api/send-email.js
// Vercel Serverless Function — Node.js with nodemailer + Gmail App Password
// Sends appointment confirmation emails from bpickard38@gmail.com → any recipient

const { transporter, renderConfirmationHtml, renderCancellationHtml } = require("./_lib");

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Validate env vars
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.error("Missing GMAIL_USER or GMAIL_APP_PASSWORD env vars");
    return res.status(500).json({ error: "Server email not configured." });
  }

  try {
    const { action, appointment } = req.body;

    if (!appointment || !appointment.attendee_email) {
      return res.status(400).json({ error: "Missing appointment data." });
    }

    const {
      id,
      cancel_token,
      attendee_name,
      attendee_email,
      start_time,
      end_time,
      meeting_type_title,
      notes,
    } = appointment;

    const startDate = new Date(start_time);
    const endDate   = new Date(end_time);
    const title     = meeting_type_title || "Bishopric Interview";
    const location  = "Bishop's Office (Manavu Chapel, up the stairs) / Provo YSA 8th Ward";
    const origin    = `https://${req.headers.host}`;
    const rescheduleUrl = `${origin}/#schedule`;

    const formattedDate = startDate.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
      timeZone: "America/Denver",
    });
    const formatTime = (d) => d.toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Denver",
    });
    const formattedTime = `${formatTime(startDate)} – ${formatTime(endDate)} (MST)`;

    // ── CANCEL ───────────────────────────────────────────────────
    if (action === "cancel") {
      const cancelHtml = renderCancellationHtml({ name: attendee_name, title, formattedDate, formattedTime, rescheduleUrl });
      await transporter.sendMail({
        from: `"Provo YSA 8th Ward" <${process.env.GMAIL_USER}>`,
        to: attendee_email,
        subject: `Cancelled: ${title} – Provo YSA 8th Ward`,
        html: cancelHtml,
      });
      return res.status(200).json({ success: true, action: "cancel" });
    }

    // ── CONFIRMATION (default / create) ──────────────────────────
    // Build Google Calendar link
    const gcalDates = `${startDate.toISOString().replace(/[-:]/g,"").split(".")[0]}Z/${endDate.toISOString().replace(/[-:]/g,"").split(".")[0]}Z`;
    const gcalUrl   = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title + " - Provo YSA 8th Ward")}&dates=${gcalDates}&location=${encodeURIComponent(location)}`;

    // Self-service cancel link only works for appointments actually saved
    // in Supabase (real id + cancel_token) — the cancel-appointment API
    // verifies the token before cancelling.
    const cancelUrl = (id && cancel_token)
      ? `${origin}/api/cancel-appointment?id=${encodeURIComponent(id)}&token=${encodeURIComponent(cancel_token)}`
      : null;

    const confirmHtml = renderConfirmationHtml({
      name: attendee_name, title, formattedDate, formattedTime, location, notes, gcalUrl, cancelUrl, rescheduleUrl,
    });

    await transporter.sendMail({
      from: `"Provo YSA 8th Ward" <${process.env.GMAIL_USER}>`,
      to: attendee_email,
      subject: `Confirmed: ${title} – Provo YSA 8th Ward`,
      html: confirmHtml,
    });

    console.log(`Confirmation email sent → ${attendee_email}`);
    return res.status(200).json({ success: true, action: "confirm", to: attendee_email });

  } catch (err) {
    console.error("send-email error:", err);
    return res.status(500).json({ error: err.message || "Failed to send email." });
  }
};
