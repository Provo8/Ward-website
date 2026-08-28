// scripts/get-google-refresh-token.js
// One-time local helper: obtains a Google OAuth refresh token for the
// Google account whose calendar should receive synced appointments.
//
// Usage:
//   1. Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local
//      (from a Google Cloud "Desktop app" OAuth client).
//   2. Run: npm run get-google-token
//   3. Open the printed URL, sign in as the account that should own the
//      calendar, and approve access.
//   4. Copy the printed GOOGLE_REFRESH_TOKEN into .env.local and into your
//      Vercel project's environment variables.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });

const http = require("http");
const { google } = require("googleapis");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env.local");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/calendar.events"],
});

console.log("\nOpen this URL in your browser and sign in as the Google account\nwhose calendar should receive synced appointments:\n");
console.log(authUrl + "\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");

  if (!code) {
    res.end("No code found in the request — check the terminal and try the URL again.");
    return;
  }

  res.end("Success! You can close this tab and return to the terminal.");
  server.close();

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log("\nSuccess. Add these to .env.local and to your Vercel project's environment variables:\n");
    console.log(`GOOGLE_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`GOOGLE_CALENDAR_ID=primary\n`);
    process.exit(0);
  } catch (err) {
    console.error("Failed to exchange code for tokens:", err.message);
    process.exit(1);
  }
});

server.listen(PORT);
