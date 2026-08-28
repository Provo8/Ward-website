// api/push-subscribe.js
// Stores a browser's Web Push subscription so that device can receive a
// notification when a new appointment is booked. Requires a valid
// full_access admin session (issued by api/admin-login.js) so only
// signed-in admins end up subscribed — otherwise any visitor could
// silently listen in on every booking.

const { supabaseServiceFetch, requireAdmin } = require("./_lib");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireAdmin(req, { role: "full_access" });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { subscription } = req.body || {};
  if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    return res.status(400).json({ error: "Invalid push subscription." });
  }

  try {
    const upsertRes = await supabaseServiceFetch("admin_push_subscriptions?on_conflict=endpoint", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
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
