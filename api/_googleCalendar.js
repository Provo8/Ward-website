// api/_googleCalendar.js
// Server-side Google Calendar sync for api/calendar-sync.js. Uses a stored
// OAuth2 refresh token (see scripts/get-google-refresh-token.js) so booked
// appointments are created/updated/deleted directly on the bishop's
// personal Google Calendar, without ever exposing credentials to the client.

const { google } = require("googleapis");

const CALENDAR_ID = (process.env.GOOGLE_CALENDAR_ID || "primary").trim();
const TIMEZONE = "America/Denver";

function isConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

function getCalendarClient() {
  if (!isConfigured()) return null;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: "v3", auth: oauth2Client });
}

function buildEventResource({ title, attendee_name, attendee_email, notes, location, start_time, end_time }) {
  return {
    summary: `${title} – ${attendee_name}`,
    location,
    description: [
      `Attendee: ${attendee_name} (${attendee_email})`,
      notes ? `Notes: ${notes}` : null,
    ].filter(Boolean).join("\n"),
    start: { dateTime: start_time, timeZone: TIMEZONE },
    end: { dateTime: end_time, timeZone: TIMEZONE },
  };
}

// Creates a new calendar event, or updates the existing one if the
// appointment already has a google_event_id. Returns the event id, or null
// if Google Calendar sync isn't configured.
async function upsertCalendarEvent(appointment) {
  const calendar = getCalendarClient();
  if (!calendar) return null;

  const resource = buildEventResource(appointment);

  if (appointment.google_event_id) {
    try {
      const { data } = await calendar.events.update({
        calendarId: CALENDAR_ID,
        eventId: appointment.google_event_id,
        requestBody: resource,
      });
      return data.id;
    } catch (err) {
      // The event was deleted/missing on the calendar side — fall through
      // and create a fresh one instead of failing the whole sync.
      if (err.code !== 404 && err.code !== 410) throw err;
    }
  }

  const { data } = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: resource,
  });
  return data.id;
}

async function deleteCalendarEvent(googleEventId) {
  const calendar = getCalendarClient();
  if (!calendar || !googleEventId) return;
  try {
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: googleEventId });
  } catch (err) {
    // Already gone — nothing to clean up.
    if (err.code !== 404 && err.code !== 410) throw err;
  }
}

module.exports = { isConfigured, upsertCalendarEvent, deleteCalendarEvent };
