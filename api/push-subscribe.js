// api/push-subscribe.js
// Stores a browser's Web Push subscription so that device can receive a
// notification when a new appointment is booked. Requires a valid admin
// session token (issued by api/admin-login.js after the correct PIN was
// entered) so only signed-in admins end up subscribed — otherwise any
// visitor could silently listen in on every booking.

const { SUPABASE_URL, SUPABASE_ANON_KEY, verifyAdminToken } = require("./_lib");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { token, subscription } = req.body || {};
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    return res.status(400).json({ error: "Invalid push subscription." });
  }

  try {
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/admin_push_subscriptions?on_conflict=endpoint`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      }),
    });

    if (!upsertRes.ok) {
      console.error("push-subscribe: Supabase upsert failed", await upsertRes.text());
      return res.status(500).json({ error: "Failed to save subscription." });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("push-subscribe error:", err);
    return res.status(500).json({ error: "Failed to save subscription." });
  }
};
