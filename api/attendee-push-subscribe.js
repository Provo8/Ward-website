// api/attendee-push-subscribe.js
// Stores a Web Push subscription for anyone who opened the site as a
// home-screen app. `email` is included once they've booked an appointment
// (used to target appointment reminders) but isn't required — a device can
// subscribe for general ward announcements before ever booking anything.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = require("./_lib");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { email, subscription } = req.body || {};
  if (email !== undefined && email !== null && (typeof email !== "string" || !email.includes("@"))) {
    return res.status(400).json({ error: "Invalid email." });
  }
  if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    return res.status(400).json({ error: "Invalid push subscription." });
  }

  try {
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/attendee_push_subscriptions?on_conflict=endpoint`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        email: email ? email.trim().toLowerCase() : null,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      }),
    });

    if (!upsertRes.ok) {
      console.error("attendee-push-subscribe: Supabase upsert failed", await upsertRes.text());
      return res.status(500).json({ error: "Failed to save subscription." });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("attendee-push-subscribe error:", err);
    return res.status(500).json({ error: "Failed to save subscription." });
  }
};
