// scripts/create-admin-user.js
// One-time (or password-reset) local helper: creates/updates an admin
// account directly in Supabase using the service-role key. This is how you
// bootstrap the very first admin (there's no "create admin" UI until at
// least one full_access admin already exists), and it's also the recovery
// path if every admin account is ever deleted.
//
// Usage:
//   npm run create-admin -- --email you@example.com --password "..." --role full_access
//
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (Supabase dashboard →
// Project Settings → API → service_role key — treat it like a DB root
// password, never commit it or ship it to the client).

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env.local") });

const { hashPassword, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = require("../api/_lib");

const VALID_ROLES = ["full_access", "announcements_only"];

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1];
      args[key] = value;
      i++;
    }
  }
  return args;
}

async function main() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const args = parseArgs();
  const email = (args.email || process.env.CREATE_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = args.password || process.env.CREATE_ADMIN_PASSWORD;
  const role = args.role || process.env.CREATE_ADMIN_ROLE || "full_access";

  if (!email || !email.includes("@")) {
    console.error("Missing/invalid --email");
    process.exit(1);
  }
  if (!password || password.length < 8) {
    console.error("Missing --password (must be at least 8 characters)");
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`Invalid --role. Must be one of: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  const password_hash = await hashPassword(password);

  // Upsert on email so re-running this script (e.g. to reset a forgotten
  // password) is safe rather than failing on the UNIQUE constraint.
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_users?on_conflict=email`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([{ email, password_hash, role }]),
  });

  if (!res.ok) {
    console.error("Failed to create/update admin:", await res.text());
    process.exit(1);
  }

  const rows = await res.json();
  const admin = Array.isArray(rows) ? rows[0] : rows;
  console.log("\nAdmin account ready:");
  console.log(`  id:         ${admin.id}`);
  console.log(`  email:      ${admin.email}`);
  console.log(`  role:       ${admin.role}`);
  console.log(`  created_at: ${admin.created_at}\n`);
}

main().catch((err) => {
  console.error("create-admin-user error:", err);
  process.exit(1);
});
