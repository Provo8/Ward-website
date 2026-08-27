// api/admin-broadcast.js
// Sends an admin-written push notification to every device that has
// installed the app (attendee_push_subscriptions, regardless of whether
// that device has ever booked) plus any signed-in admin devices
// (admin_push_subscriptions). Requires a valid admin session token.

const webpush = require("web-push");
const { SUPABASE_URL, SUPABASE_ANON_KEY, verifyAdminToken } = require("./_lib");

async function fetchAllSubscriptions(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=endpoint,p256dh,auth`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) return [];
  return res.json();
}

async function removeSubscriptionEverywhere(endpoint) {
  await Promise.all(
    ["attendee_push_subscriptions", "admin_push_subscriptions"].map((table) =>
      fetch(`${SUPABASE_URL}/rest/v1/${table}?endpoint=eq.${encodeURIComponent(endpoint)}`, {
        method: "DELETE",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      })
    )
  );
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { token, title, body, url } = req.body || {};
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!title || !body || typeof title !== "string" || typeof body !== "string") {
    return res.status(400).json({ error: "Missing title or message." });
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars");
    return res.status(500).json({ error: "Push notifications not configured." });
  }

  webpush.setVapidDetails(
    "mailto:bpickard38@gmail.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const payload = JSON.stringify({ title, body, url: url || "./" });

  try {
    const [siteSubs, adminSubs] = await Promise.all([
      fetchAllSubscriptions("attendee_push_subscriptions"),
      fetchAllSubscriptions("admin_push_subscriptions"),
    ]);

    // De-dupe by endpoint in case a device shows up in both tables
    const byEndpoint = new Map();
    for (const sub of [...siteSubs, ...adminSubs]) {
      byEndpoint.set(sub.endpoint, sub);
    }
    const allSubs = Array.from(byEndpoint.values());

    const results = await Promise.allSettled(
      allSubs.map((sub) =>
        webpush
          .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
          .catch((err) => {
            if (err.statusCode === 404 || err.statusCode === 410) {
              return removeSubscriptionEverywhere(sub.endpoint);
            }
            throw err;
          })
      )
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    return res.status(200).json({ success: true, sent, total: allSubs.length });
  } catch (err) {
    console.error("admin-broadcast error:", err);
    return res.status(500).json({ error: "Failed to send announcement." });
  }
};
