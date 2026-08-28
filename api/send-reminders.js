// api/send-reminders.js
// Vercel Serverless Function — called every few minutes by an external cron
// (GitHub Actions, since Vercel's Hobby plan only allows daily cron jobs).
// Finds confirmed appointments starting in ~24 hours or ~30 minutes that
// haven't been reminded yet, emails a reminder, push-notifies the attendee
// if they've subscribed (home-screen app), and marks them as sent.

const webpush = require("web-push");
const { supabaseServiceFetch, transporter, renderReminderHtml } = require("./_lib");

// Cron runs every 5 min; a wider window means a missed/late run still catches
// the appointment on the next pass. The *_sent_at flag prevents duplicates.
const WINDOW_MINUTES = 10;

const REMINDER_STAGES = [
  { minutesAhead: 24 * 60, column: "reminder_24h_sent_at", label: "24h" },
  { minutesAhead: 30, column: "reminder_30m_sent_at", label: "30m" },
];

async function fetchDueAppointments(minutesAhead, column) {
  const now = new Date();
  const from = new Date(now.getTime() + (minutesAhead - WINDOW_MINUTES) * 60000);
  const to = new Date(now.getTime() + (minutesAhead + WINDOW_MINUTES) * 60000);

  const params = new URLSearchParams();
  params.set("select", "*,meeting_types(title)");
  params.set("status", "eq.confirmed");
  params.set(column, "is.null");
  params.append("start_time", `gte.${from.toISOString()}`);
  params.append("start_time", `lte.${to.toISOString()}`);

  const res = await supabaseServiceFetch(`appointments?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Supabase select failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function markReminded(id, column) {
  const res = await supabaseServiceFetch(`appointments?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ [column]: new Date().toISOString() }),
  });
  if (!res.ok) {
    console.error(`send-reminders: failed to mark ${column} for ${id}:`, await res.text());
  }
}

async function fetchAttendeeSubscriptions(email) {
  if (!email) return [];
  const res = await supabaseServiceFetch(`attendee_push_subscriptions?email=eq.${encodeURIComponent(email.trim().toLowerCase())}`);
  if (!res.ok) return [];
  return res.json();
}

async function removeAttendeeSubscription(endpoint) {
  await supabaseServiceFetch(`attendee_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: "DELETE",
  });
}

async function pushToAttendee(appt, title, formattedDate, formattedTime, label) {
  const subs = await fetchAttendeeSubscriptions(appt.attendee_email);
  if (!subs.length) return;

  const payload = JSON.stringify({
    title: label === "24h" ? "Appointment Tomorrow" : "Appointment in 30 Minutes",
    body: `${title} — ${formattedDate} at ${formattedTime}`,
    url: "./#schedule",
  });

  await Promise.allSettled(
    subs.map((sub) =>
      webpush
        .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        .catch((err) => {
          if (err.statusCode === 404 || err.statusCode === 410) {
            return removeAttendeeSubscription(sub.endpoint);
          }
          console.warn(`send-reminders: attendee push failed for ${appt.id}:`, err.message);
        })
    )
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = req.headers["x-cron-secret"] || req.query.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.error("Missing GMAIL_USER or GMAIL_APP_PASSWORD env vars");
    return res.status(500).json({ error: "Server email not configured." });
  }

  const pushConfigured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  if (pushConfigured) {
    webpush.setVapidDetails(
      "mailto:bpickard38@gmail.com",
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  }

  const origin = process.env.SITE_URL || `https://${req.headers.host}`;
  const location = "Bishop's Office (LSB 2nd Floor) / Provo YSA 8th Ward";
  const results = { sent24h: 0, sent30m: 0, errors: [] };

  try {
    for (const stage of REMINDER_STAGES) {
      const due = await fetchDueAppointments(stage.minutesAhead, stage.column);

      for (const appt of due) {
        try {
          const startDate = new Date(appt.start_time);
          const endDate = new Date(appt.end_time);
          const title = (appt.meeting_types && appt.meeting_types.title) || "Bishopric Interview";

          const formattedDate = startDate.toLocaleDateString("en-US", {
            weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Denver",
          });
          const formatTime = (d) => d.toLocaleTimeString("en-US", {
            hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Denver",
          });
          const formattedTime = `${formatTime(startDate)} – ${formatTime(endDate)} (MST)`;

          const gcalDates = `${startDate.toISOString().replace(/[-:]/g, "").split(".")[0]}Z/${endDate.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
          const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title + " - Provo YSA 8th Ward")}&dates=${gcalDates}&location=${encodeURIComponent(location)}`;

          const cancelUrl = appt.cancel_token
            ? `${origin}/api/cancel-appointment?id=${encodeURIComponent(appt.id)}&token=${encodeURIComponent(appt.cancel_token)}`
            : null;
          const rescheduleUrl = `${origin}/#schedule`;

          const html = renderReminderHtml({
            name: appt.attendee_name, title, formattedDate, formattedTime, location,
            notes: appt.notes, gcalUrl, cancelUrl, rescheduleUrl, label: stage.label,
          });

          await transporter.sendMail({
            from: `"Provo YSA 8th Ward" <${process.env.GMAIL_USER}>`,
            to: appt.attendee_email,
            subject: `Reminder: ${title} in ${stage.label === "24h" ? "24 hours" : "30 minutes"} – Provo YSA 8th Ward`,
            html,
          });

          if (pushConfigured) {
            try {
              await pushToAttendee(appt, title, formattedDate, formattedTime, stage.label);
            } catch (pushErr) {
              console.warn(`send-reminders: attendee push lookup failed for ${appt.id}:`, pushErr);
            }
          }

          await markReminded(appt.id, stage.column);
          results[`sent${stage.label}`]++;
        } catch (err) {
          console.error(`send-reminders: failed for appointment ${appt.id}:`, err);
          results.errors.push({ id: appt.id, error: err.message });
        }
      }
    }

    return res.status(200).json({ success: true, ...results });
  } catch (err) {
    console.error("send-reminders error:", err);
    return res.status(500).json({ error: err.message || "Failed to send reminders." });
  }
};
