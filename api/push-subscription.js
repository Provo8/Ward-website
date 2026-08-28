// api/push-subscription.js
// Vercel Serverless Function — subscribe/unsubscribe an admin device for
// new-appointment push alerts, dispatched by `action`. Combined into one
// route (was api/push-subscribe.js + api/push-unsubscribe.js) to stay under
// Vercel's per-deployment serverless function limit on the Hobby plan.
// full_access only — only signed-in full_access admins may listen in on
// new bookings.

const { supabaseServiceFetch, requireAdmin } = require("./_lib");

async function handleSubscribe(req, res) {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
    return res.status(400).json({ error: "Invalid push subscription." });
  }

  const upsertRes = await supabaseServiceFetch("admin_push_subscriptions?on_conflict=endpoint", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    }),
  });
  if (!upsertRes.ok) throw new Error(await upsertRes.text());

  return res.status(200).json({ success: true });
}

async function handleUnsubscribe(req, res) {
  const { endpoint } = req.body;
  if (!endpoint || typeof endpoint !== "string") {
    return res.status(400).json({ error: "Missing endpoint." });
  }

  await supabaseServiceFetch(`admin_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: "DELETE" });
  return res.status(200).json({ success: true });
}

const ACTION_HANDLERS = { subscribe: handleSubscribe, unsubscribe: handleUnsubscribe };

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireAdmin(req, { role: "full_access" });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { action } = req.body || {};
  const actionHandler = ACTION_HANDLERS[action];
  if (!actionHandler) return res.status(400).json({ error: "Unknown action." });

  try {
    return await actionHandler(req, res);
  } catch (err) {
    console.error(`push-subscription (${action}) error:`, err);
    return res.status(500).json({ error: "Failed to save subscription." });
  }
};
