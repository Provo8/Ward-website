// api/notify-admins.js
// Sends a Web Push notification to every subscribed admin device when a
// new appointment is booked (or rescheduled) through the public booking flow.

const webpush = require("web-push");
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require("./_lib");

async function fetchSubscriptions() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_push_subscriptions?select=*`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Failed to load subscriptions: ${res.status}`);
  return res.json();
}

async function removeSubscription(endpoint) {
  await fetch(`${SUPABASE_URL}/rest/v1/admin_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: "DELETE",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars");
    return res.status(500).json({ error: "Push notifications not configured." });
  }

  const { appointment } = req.body || {};
  if (!appointment || !appointment.attendee_name) {
    return res.status(400).json({ error: "Missing appointment." });
  }

  webpush.setVapidDetails(
    "mailto:bpickard38@gmail.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const title = appointment.meeting_type_title || "Bishopric Interview";
  const startDate = appointment.start_time ? new Date(appointment.start_time) : null;
  const timeText = startDate
    ? startDate.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZone: "America/Denver",
      })
    : "";

  const payload = JSON.stringify({
    title: "New Appointment Booked",
    body: `${appointment.attendee_name} — ${title}${timeText ? ` on ${timeText}` : ""}`,
    url: "/#admin-scheduling",
  });

  try {
    const subs = await fetchSubscriptions();

    const results = await Promise.allSettled(
      subs.map((sub) =>
        webpush
          .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
          .catch((err) => {
            // 404/410 means the browser unsubscribed or the endpoint expired
            if (err.statusCode === 404 || err.statusCode === 410) {
              return removeSubscription(sub.endpoint);
            }
            throw err;
          })
      )
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    return res.status(200).json({ success: true, sent, total: subs.length });
  } catch (err) {
    console.error("notify-admins error:", err);
    return res.status(500).json({ error: "Failed to notify admins." });
  }
};
