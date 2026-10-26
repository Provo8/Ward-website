// scripts/seed-leaders.js
// One-time local helper: loads the leadership directory (Contact tab) into
// the ward_leaders table and uploads each leader's photo to the
// `leader-photos` Storage bucket. After the first seed, day-to-day edits
// happen in the admin portal (Admins tab → Leadership Directory).
//
// Leaders' names, phone numbers, and photos are personal info, so they are
// never committed: the real data lives in scripts/leaders.local.json and
// the photos in pictures/ (both gitignored). scripts/leaders.example.json
// shows the format with placeholder data.
//
// Usage:
//   npm run seed-leaders                                  (uses scripts/leaders.local.json)
//   npm run seed-leaders -- --file scripts/leaders.example.json
//   npm run seed-leaders -- --replace                     (wipe existing rows first)
//
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local.

const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const { SUPABASE_SERVICE_ROLE_KEY, supabaseServiceFetch, ensureLeaderPhotoBucket, uploadLeaderPhoto } = require("../api/_lib");

const PHOTO_CONTENT_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function parseArgs() {
  const argv = process.argv.slice(2);
  const fileIndex = argv.indexOf("--file");
  return {
    file: fileIndex !== -1 ? argv[fileIndex + 1] : path.join("scripts", "leaders.local.json"),
    replace: argv.includes("--replace"),
  };
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function main() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const args = parseArgs();
  const dataPath = path.resolve(path.join(__dirname, ".."), args.file);
  if (!fs.existsSync(dataPath)) {
    console.error(`Leader data file not found: ${dataPath}`);
    console.error("Copy scripts/leaders.example.json to scripts/leaders.local.json and fill it in.");
    process.exit(1);
  }

  const { photoDir = "pictures", leaders } = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  if (!Array.isArray(leaders) || leaders.length === 0) {
    console.error("No leaders found in the data file.");
    process.exit(1);
  }

  const existingRes = await supabaseServiceFetch("ward_leaders?select=id");
  if (!existingRes.ok) throw new Error(`Couldn't read ward_leaders (has schema.sql been run?): ${await existingRes.text()}`);
  const existing = await existingRes.json();

  if (existing.length > 0) {
    if (!args.replace) {
      console.error(`ward_leaders already has ${existing.length} row(s). Re-run with --replace to wipe and reseed.`);
      process.exit(1);
    }
    const delRes = await supabaseServiceFetch("ward_leaders?id=neq.00000000-0000-0000-0000-000000000000", { method: "DELETE" });
    if (!delRes.ok) throw new Error(await delRes.text());
    console.log(`Removed ${existing.length} existing row(s).`);
  }

  await ensureLeaderPhotoBucket();

  const photoRoot = path.resolve(path.join(__dirname, ".."), photoDir);
  const rows = [];
  for (const [index, leader] of leaders.entries()) {
    let photo_url = leader.photo_url || null;

    if (leader.photo) {
      const photoPath = path.join(photoRoot, leader.photo);
      const ext = path.extname(photoPath).toLowerCase();
      if (!fs.existsSync(photoPath)) {
        console.warn(`  ! Photo not found for ${leader.name}: ${photoPath} (skipping photo)`);
      } else if (!PHOTO_CONTENT_TYPES[ext]) {
        console.warn(`  ! Unsupported photo type for ${leader.name}: ${ext} (skipping photo)`);
      } else {
        photo_url = await uploadLeaderPhoto(`${slugify(leader.name)}${ext}`, fs.readFileSync(photoPath), PHOTO_CONTENT_TYPES[ext]);
      }
    }

    rows.push({
      name: leader.name,
      calling: leader.calling,
      phone: leader.phone || null,
      photo_url,
      note: leader.note || null,
      section: leader.section || "ward",
      sort_order: leader.sort_order ?? index,
      show_schedule_button: Boolean(leader.show_schedule_button),
      is_active: leader.is_active !== false,
    });
    console.log(`  ✓ ${leader.name} — ${leader.calling}${photo_url ? " (photo)" : ""}`);
  }

  const insertRes = await supabaseServiceFetch("ward_leaders", { method: "POST", body: JSON.stringify(rows) });
  if (!insertRes.ok) throw new Error(await insertRes.text());

  console.log(`\nSeeded ${rows.length} leader(s).\n`);
}

main().catch((err) => {
  console.error("seed-leaders error:", err);
  process.exit(1);
});
