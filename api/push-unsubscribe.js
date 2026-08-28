// api/push-unsubscribe.js
// Removes a Web Push subscription, called on admin logout so a signed-out
// device stops receiving new-appointment notifications. Requires a valid
// admin session (still present at the moment logout fires, before
// sessionStorage is cleared) so an arbitrary visitor can't unsubscribe an
// admin's device by guessing/observing its endpoint.

const { supabaseServiceFetch, requireAdmin } = require("./_lib");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireAdmin(req, { role: "full_access" });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { endpoint } = req.body || {};
  if (!endpoint || typeof endpoint !== "string") {
    return res.status(400).json({ error: "Missing endpoint." });
  }

  try {
    await supabaseServiceFetch(`admin_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
      method: "DELETE",
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("push-unsubscribe error:", err);
    return res.status(500).json({ error: "Failed to remove subscription." });
  }
};
