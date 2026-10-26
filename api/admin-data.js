// api/admin-data.js
// Vercel Serverless Function — full_access/scheduling_access admin
// mutations/reads for meeting types, weekly availability, date overrides,
// ward settings, the full-PII appointments feed/update/cancel actions, and
// (full_access only) the Contact tab's leadership directory.
// announcements_only admins may not reach this endpoint. Combined into one route
// (dispatched by `resource`) to stay under Vercel's per-deployment
// serverless function limit on the Hobby plan — each of these used to be
// its own file; the request/response shapes are unchanged, just routed
// through one endpoint instead of several.

const crypto = require("crypto");
const { supabaseServiceFetch, requireAdmin, sendAdminPush, ensureLeaderPhotoBucket, uploadLeaderPhoto } = require("./_lib");

async function handleMeetingTypes(req, res) {
  const { action, id } = req.body;

  if (action === "create") {
    const { title, description, duration_minutes, buffer_minutes, assigned_to, is_active } = req.body;
    if (!title) return res.status(400).json({ error: "Title is required." });

    const createRes = await supabaseServiceFetch("meeting_types", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([{ title, description, duration_minutes, buffer_minutes, assigned_to, is_active }]),
    });
    if (!createRes.ok) throw new Error(await createRes.text());
    const created = await createRes.json();
    return res.status(200).json({ success: true, meeting_type: Array.isArray(created) ? created[0] : created });
  }

  if (action === "update") {
    if (!id) return res.status(400).json({ error: "Missing meeting type id." });
    const { title, description, duration_minutes, buffer_minutes, assigned_to, is_active } = req.body;

    const updateRes = await supabaseServiceFetch(`meeting_types?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title, description, duration_minutes, buffer_minutes, assigned_to, is_active }),
    });
    if (!updateRes.ok) throw new Error(await updateRes.text());
    return res.status(200).json({ success: true });
  }

  if (action === "toggle_active") {
    if (!id) return res.status(400).json({ error: "Missing meeting type id." });
    const { is_active } = req.body;

    const toggleRes = await supabaseServiceFetch(`meeting_types?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: Boolean(is_active) }),
    });
    if (!toggleRes.ok) throw new Error(await toggleRes.text());
    return res.status(200).json({ success: true });
  }

  if (action === "delete") {
    if (!id) return res.status(400).json({ error: "Missing meeting type id." });

    const deleteRes = await supabaseServiceFetch(`meeting_types?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!deleteRes.ok) throw new Error(await deleteRes.text());
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: "Unknown action." });
}

async function handleWeeklyAvailability(req, res) {
  const { action } = req.body;

  if (action === "delete_day") {
    const { day_of_week } = req.body;
    if (typeof day_of_week !== "number") return res.status(400).json({ error: "Missing day_of_week." });

    const delRes = await supabaseServiceFetch(`weekly_availability?day_of_week=eq.${day_of_week}`, { method: "DELETE" });
    if (!delRes.ok) throw new Error(await delRes.text());
    return res.status(200).json({ success: true });
  }

  if (action === "delete_slot") {
    const { id, day_of_week, start_time } = req.body;
    const path = id
      ? `weekly_availability?id=eq.${encodeURIComponent(id)}`
      : `weekly_availability?day_of_week=eq.${day_of_week}&start_time=eq.${encodeURIComponent(start_time)}`;

    const delRes = await supabaseServiceFetch(path, { method: "DELETE" });
    if (!delRes.ok) throw new Error(await delRes.text());
    return res.status(200).json({ success: true });
  }

  if (action === "replace_all") {
    const { slots } = req.body;
    if (!Array.isArray(slots)) return res.status(400).json({ error: "Missing slots array." });

    const delRes = await supabaseServiceFetch("weekly_availability?id=neq.00000000-0000-0000-0000-000000000000", { method: "DELETE" });
    if (!delRes.ok) throw new Error(await delRes.text());

    if (slots.length > 0) {
      const payload = slots.map((s) => ({ day_of_week: s.day_of_week, start_time: s.start_time, end_time: s.end_time }));
      const insertRes = await supabaseServiceFetch("weekly_availability", { method: "POST", body: JSON.stringify(payload) });
      if (!insertRes.ok) throw new Error(await insertRes.text());
    }

    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: "Unknown action." });
}

async function handleDateOverrides(req, res) {
  const { action } = req.body;

  if (action === "save") {
    const { override_date, is_unavailable, start_time, end_time } = req.body;
    if (!override_date) return res.status(400).json({ error: "Missing override_date." });

    const delRes = await supabaseServiceFetch(`date_overrides?override_date=eq.${encodeURIComponent(override_date)}`, { method: "DELETE" });
    if (!delRes.ok) throw new Error(await delRes.text());

    const insertRes = await supabaseServiceFetch("date_overrides", {
      method: "POST",
      body: JSON.stringify([{
        override_date,
        is_unavailable: Boolean(is_unavailable),
        start_time: is_unavailable ? null : start_time,
        end_time: is_unavailable ? null : end_time,
      }]),
    });
    if (!insertRes.ok) throw new Error(await insertRes.text());

    return res.status(200).json({ success: true });
  }

  if (action === "delete") {
    const { id, override_date } = req.body;
    if (id) {
      const delRes = await supabaseServiceFetch(`date_overrides?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!delRes.ok) throw new Error(await delRes.text());
    }
    if (override_date) {
      const delRes = await supabaseServiceFetch(`date_overrides?override_date=eq.${encodeURIComponent(override_date)}`, { method: "DELETE" });
      if (!delRes.ok) throw new Error(await delRes.text());
    }
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: "Unknown action." });
}

async function handleSettings(req, res) {
  const { id, accepting_appointments } = req.body;
  if (!id) return res.status(400).json({ error: "Missing settings id." });

  const updateRes = await supabaseServiceFetch(`ward_scheduling_settings?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ accepting_appointments: Boolean(accepting_appointments) }),
  });
  if (!updateRes.ok) throw new Error(await updateRes.text());
  return res.status(200).json({ success: true });
}

async function handleAppointments(req, res) {
  const { action, id } = req.body;

  if (action === "admin_feed") {
    const listRes = await supabaseServiceFetch("appointments?select=*,meeting_types(title)&order=start_time.asc");
    if (!listRes.ok) throw new Error(await listRes.text());
    const appointments = await listRes.json();
    return res.status(200).json({ success: true, appointments });
  }

  if (action === "update") {
    if (!id) return res.status(400).json({ error: "Missing appointment id." });
    const { notes, admin_notes } = req.body;

    const patch = {};
    if (notes !== undefined) patch.notes = notes || null;
    if (admin_notes !== undefined) patch.admin_notes = admin_notes || null;
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: "Nothing to update." });

    const updateRes = await supabaseServiceFetch(`appointments?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (!updateRes.ok) throw new Error(await updateRes.text());
    return res.status(200).json({ success: true });
  }

  if (action === "cancel") {
    if (!id) return res.status(400).json({ error: "Missing appointment id." });

    const lookupRes = await supabaseServiceFetch(`appointments?id=eq.${encodeURIComponent(id)}&select=attendee_name,start_time,meeting_types(title)`);
    const lookupRows = lookupRes.ok ? await lookupRes.json() : [];
    const cancelled = Array.isArray(lookupRows) ? lookupRows[0] : null;

    const deleteRes = await supabaseServiceFetch(`appointments?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!deleteRes.ok) throw new Error(await deleteRes.text());

    if (cancelled) {
      try {
        const title = (cancelled.meeting_types && cancelled.meeting_types.title) || "Bishopric Interview";
        const startDate = cancelled.start_time ? new Date(cancelled.start_time) : null;
        const timeText = startDate
          ? startDate.toLocaleString("en-US", {
              weekday: "short", month: "short", day: "numeric",
              hour: "numeric", minute: "2-digit", timeZone: "America/Denver",
            })
          : "";
        await sendAdminPush({
          title: "Appointment Cancelled",
          body: `${cancelled.attendee_name} — ${title}${timeText ? ` on ${timeText}` : ""}`,
          url: "/#admin-scheduling",
        });
      } catch (pushErr) {
        console.warn("admin-data (appointments/cancel): failed to push-notify admins", pushErr);
      }
    }

    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: "Unknown action." });
}

const LEADER_FIELDS = ["name", "calling", "phone", "photo_url", "note", "section", "sort_order", "show_schedule_button", "is_active"];
const LEADER_PHOTO_TYPES = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

function pickLeaderFields(body) {
  const row = {};
  LEADER_FIELDS.forEach((field) => {
    if (body[field] !== undefined) row[field] = body[field] === "" ? null : body[field];
  });
  return row;
}

async function handleLeaders(req, res) {
  const { action, id } = req.body;

  if (action === "list") {
    // Includes inactive leaders (the public anon read only sees active ones).
    const listRes = await supabaseServiceFetch("ward_leaders?select=*&order=section.asc,sort_order.asc,name.asc");
    if (!listRes.ok) throw new Error(await listRes.text());
    return res.status(200).json({ success: true, leaders: await listRes.json() });
  }

  if (action === "create" || action === "update") {
    const row = pickLeaderFields(req.body);
    if (action === "create" && (!row.name || !row.calling)) {
      return res.status(400).json({ error: "Name and calling are required." });
    }
    if (row.section && !["bishopric", "ward"].includes(row.section)) {
      return res.status(400).json({ error: "Invalid section." });
    }

    if (action === "create") {
      const createRes = await supabaseServiceFetch("ward_leaders", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([row]),
      });
      if (!createRes.ok) throw new Error(await createRes.text());
      const created = await createRes.json();
      return res.status(200).json({ success: true, leader: Array.isArray(created) ? created[0] : created });
    }

    if (!id) return res.status(400).json({ error: "Missing leader id." });
    const updateRes = await supabaseServiceFetch(`ward_leaders?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(row),
    });
    if (!updateRes.ok) throw new Error(await updateRes.text());
    return res.status(200).json({ success: true });
  }

  if (action === "delete") {
    if (!id) return res.status(400).json({ error: "Missing leader id." });
    const deleteRes = await supabaseServiceFetch(`ward_leaders?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!deleteRes.ok) throw new Error(await deleteRes.text());
    return res.status(200).json({ success: true });
  }

  if (action === "upload_photo") {
    // The browser downsizes the image before sending (see
    // resizeLeaderPhoto() in scheduling-admin.js), so this stays well
    // under Vercel's 4.5 MB request body limit.
    const { data_url } = req.body;
    const match = /^data:(image\/[a-z]+);base64,(.+)$/.exec(data_url || "");
    if (!match || !LEADER_PHOTO_TYPES[match[1]]) {
      return res.status(400).json({ error: "Photo must be a JPEG, PNG, or WebP image." });
    }
    await ensureLeaderPhotoBucket();
    const objectName = `${crypto.randomUUID()}${LEADER_PHOTO_TYPES[match[1]]}`;
    const photo_url = await uploadLeaderPhoto(objectName, Buffer.from(match[2], "base64"), match[1]);
    return res.status(200).json({ success: true, photo_url });
  }

  return res.status(400).json({ error: "Unknown action." });
}

const RESOURCE_HANDLERS = {
  meeting_types: handleMeetingTypes,
  weekly_availability: handleWeeklyAvailability,
  date_overrides: handleDateOverrides,
  settings: handleSettings,
  appointments: handleAppointments,
  leaders: handleLeaders,
};

// Resources narrower than this endpoint's default full_access/scheduling_access.
const RESOURCE_ROLES = {
  leaders: ["full_access"],
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await requireAdmin(req, { role: ["full_access", "scheduling_access"] });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { resource } = req.body || {};
  const resourceHandler = RESOURCE_HANDLERS[resource];
  if (!resourceHandler) return res.status(400).json({ error: "Unknown resource." });
  if (RESOURCE_ROLES[resource] && !RESOURCE_ROLES[resource].includes(auth.admin.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    return await resourceHandler(req, res);
  } catch (err) {
    console.error(`admin-data (${resource}) error:`, err);
    return res.status(500).json({ error: "Failed to save changes." });
  }
};
