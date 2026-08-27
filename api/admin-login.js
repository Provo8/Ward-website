// api/admin-login.js
// Vercel Serverless Function — verifies the leadership admin PIN server-side.
// The real PIN lives only in the ADMIN_PIN environment variable and is never
// sent to the browser or stored client-side; a signed, time-limited session
// token is returned instead so the JS source never reveals a working PIN.

const crypto = require("crypto");
const { signAdminPayload } = require("./_lib");

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ADMIN_PIN) {
    console.error("Missing ADMIN_PIN env var");
    return res.status(500).json({ error: "Admin login is not configured." });
  }

  const { pin } = req.body || {};
  if (!pin || typeof pin !== "string") {
    return res.status(400).json({ error: "Missing PIN." });
  }

  const isMatch = pin.length === process.env.ADMIN_PIN.length && safeEqual(pin, process.env.ADMIN_PIN);
  if (!isMatch) {
    return res.status(401).json({ success: false, error: "Incorrect passcode." });
  }

  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })).toString("base64url");
  const token = `${payload}.${signAdminPayload(payload)}`;

  return res.status(200).json({ success: true, token });
};
