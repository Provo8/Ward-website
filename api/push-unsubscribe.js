// api/push-unsubscribe.js
// Removes a Web Push subscription, called on admin logout so a signed-out
// device stops receiving new-appointment notifications.

const { SUPABASE_URL, SUPABASE_ANON_KEY } = require("./_lib");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { endpoint } = req.body || {};
  if (!endpoint || typeof endpoint !== "string") {
    return res.status(400).json({ error: "Missing endpoint." });
  }

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/admin_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("push-unsubscribe error:", err);
    return res.status(500).json({ error: "Failed to remove subscription." });
  }
};
