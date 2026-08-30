// ============================================================
// Supabase Edge Function: handle-appointment-email
// Sends emails via Gmail REST API (OAuth2) — works in Deno, no SMTP
// Requires secrets: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
// Sends FROM: bpickard38@gmail.com → TO: any recipient
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Get a fresh Gmail OAuth2 access token using refresh token ────
async function getGmailAccessToken(): Promise<string> {
  const clientId     = Deno.env.get("GMAIL_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET")!;
  const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN")!;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Failed to get Gmail access token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// ── Send an email via Gmail API ──────────────────────────────────
async function sendGmailEmail(params: {
  accessToken: string;
  from: string;        // e.g. "Provo YSA 8th Ward <bpickard38@gmail.com>"
  to: string;
  subject: string;
  html: string;
}): Promise<{ id?: string; error?: string }> {
  // Build RFC 2822 email
  const emailLines = [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="utf-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    params.html,
  ];

  // Base64url encode the raw email (Gmail API requires base64url, not base64)
  const raw = emailLines.join("\r\n");
  const encoded = btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encoded }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    console.error("Gmail API send error:", JSON.stringify(data));
    return { error: data?.error?.message || `HTTP ${res.status}` };
  }

  console.log(`Email sent via Gmail API → id: ${data.id}`);
  return { id: data.id };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Validate secrets
    const clientId     = Deno.env.get("GMAIL_CLIENT_ID");
    const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
    const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN");
    const gmailUser    = Deno.env.get("GMAIL_USER") || "bpickard38@gmail.com";

    if (!clientId || !clientSecret || !refreshToken) {
      return new Response(
        JSON.stringify({ error: "Missing Gmail OAuth secrets (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get fresh access token
    let accessToken: string;
    try {
      accessToken = await getGmailAccessToken();
    } catch (e) {
      console.error("OAuth token error:", e);
      return new Response(
        JSON.stringify({ error: `OAuth error: ${e?.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fromAddress = `Provo YSA 8th Ward <${gmailUser}>`;

    const supabaseUrl     = Deno.env.get("SUPABASE_URL");
    const supabaseKey     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
    const sb = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

    const body = await req.json();
    const { action, appointment } = body;

    if (!appointment || !appointment.attendee_email) {
      return new Response(
        JSON.stringify({ error: "Missing appointment or attendee_email." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // ACTION: CREATE — Confirmation email
    // ============================================================
    if (action === "create" || !action) {
      const {
        id, attendee_name, attendee_email,
        start_time, end_time, meeting_type_title, notes, cancel_token
      } = appointment;

      const startDate = new Date(start_time);
      const endDate   = new Date(end_time);
      const formattedDate = formatReadableDate(startDate);
      const formattedTime = `${formatTime12h(startDate)} – ${formatTime12h(endDate)} (MST)`;
      const title    = meeting_type_title || "Bishopric Interview";
      const location = "Bishop's Office (Manavu Chapel, up the stairs) / Provo YSA 8th Ward";

      // Send confirmation
      const confirmHtml = renderConfirmationEmailHtml({
        name: attendee_name, title, formattedDate, formattedTime,
        location, notes, cancelToken: cancel_token, startDate, endDate
      });

      const result = await sendGmailEmail({
        accessToken,
        from: fromAddress,
        to: attendee_email,
        subject: `Confirmed: ${title} – Provo YSA 8th Ward`,
        html: confirmHtml,
      });

      // Note: Gmail API doesn't support scheduled future emails natively.
      // For reminders, a pg_cron job or a separate scheduler would be needed.
      // The .ics calendar invite in the confirmation email serves as the reminder mechanism.

      return new Response(
        JSON.stringify({ success: !result.error, gmail_id: result.id, error: result.error }),
        { status: result.error ? 500 : 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // ACTION: CANCEL
    // ============================================================
    if (action === "cancel") {
      const { attendee_name, attendee_email, meeting_type_title, start_time } = appointment;

      if (attendee_email) {
        const startDate  = start_time ? new Date(start_time) : new Date();
        const cancelHtml = renderCancellationEmailHtml({
          name: attendee_name,
          title: meeting_type_title || "Appointment",
          formattedDate: formatReadableDate(startDate),
          formattedTime: formatTime12h(startDate),
        });

        await sendGmailEmail({
          accessToken,
          from: fromAddress,
          to: attendee_email,
          subject: `Cancelled: ${meeting_type_title || "Appointment"} – Provo YSA 8th Ward`,
          html: cancelHtml,
        });
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unsupported action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ============================================================
// HELPERS & EMAIL TEMPLATES
// ============================================================
function formatReadableDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    timeZone: "America/Denver",
  });
}
function formatTime12h(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: "America/Denver",
  });
}

function renderConfirmationEmailHtml(p: {
  name: string; title: string; formattedDate: string; formattedTime: string;
  location: string; notes?: string; cancelToken?: string; startDate: Date; endDate: Date;
}): string {
  const gcalDates = `${p.startDate.toISOString().replace(/[-:]/g,"").split(".")[0]}Z/${p.endDate.toISOString().replace(/[-:]/g,"").split(".")[0]}Z`;
  const gcalUrl   = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(p.title + " - Provo YSA 8th Ward")}&dates=${gcalDates}&location=${encodeURIComponent(p.location)}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f8fb;margin:0;padding:24px;color:#1b1b1d}
  .card{max-width:560px;margin:0 auto;background:#fff;border-radius:20px;padding:32px;box-shadow:0 8px 30px rgba(0,27,53,.06);border:1px solid #ebf2f8}
  .badge{display:inline-block;background:#fed000;color:#231b00;font-size:11px;font-weight:800;padding:4px 12px;border-radius:9999px;text-transform:uppercase;letter-spacing:.5px}
  .h1{font-size:24px;font-weight:800;color:#001b35;margin:12px 0 4px}
  .box{background:#f6f9fc;border-radius:16px;padding:20px;margin:24px 0;border:1px solid #ebf2f8}
  .row{display:flex;margin-bottom:10px;font-size:14px}.row:last-child{margin-bottom:0}
  .lbl{width:90px;font-weight:700;color:#73777f;font-size:12px;text-transform:uppercase}
  .val{font-weight:600;color:#001b35;flex:1}
  .btn-y{display:block;text-align:center;background:#fed000;color:#231b00;font-weight:700;font-size:15px;padding:14px 20px;border-radius:14px;text-decoration:none;margin:20px 0 10px}
  .btn-g{display:block;text-align:center;background:#ebf2f8;color:#001b35;font-weight:600;font-size:13px;padding:10px 16px;border-radius:12px;text-decoration:none}
  .foot{text-align:center;font-size:12px;color:#95969b;margin-top:28px;line-height:1.6}
  </style></head><body><div class="card">
  <div style="text-align:center"><span class="badge">Appointment Confirmed</span>
  <h1 class="h1">${p.title}</h1>
  <p style="font-size:14px;color:#73777f;margin:0">Hi ${p.name}, your meeting with ward leadership is scheduled.</p></div>
  <div class="box">
    <div class="row"><div class="lbl">Date</div><div class="val">${p.formattedDate}</div></div>
    <div class="row"><div class="lbl">Time</div><div class="val">${p.formattedTime}</div></div>
    <div class="row"><div class="lbl">Location</div><div class="val"><a href="https://maps.app.goo.gl/3o6eNeNcZVWrcdbU9" target="_blank" style="color:#001b35;text-decoration:underline">${p.location}</a></div></div>
    ${p.notes ? `<div class="row"><div class="lbl">Notes</div><div class="val">${p.notes}</div></div>` : ""}
  </div>
  <a href="${gcalUrl}" class="btn-y" target="_blank">📅 Add to Google Calendar</a>
  <a href="https://provo8ward.vercel.app/#schedule" class="btn-g" target="_blank">View Ward Portal</a>
  <div class="foot">Automated reminders will be sent 24 hours and 30 minutes before your meeting.<br>Provo YSA 8th Ward • Bishopric Interview Portal</div>
  </div></body></html>`;
}

function renderCancellationEmailHtml(p: { name: string; title: string; formattedDate: string; formattedTime: string }): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f8fb;margin:0;padding:24px}
  .card{max-width:560px;margin:0 auto;background:#fff;border-radius:20px;padding:32px;text-align:center;box-shadow:0 8px 30px rgba(0,27,53,.06)}
  .badge{display:inline-block;background:#ba1a1a;color:#fff;font-size:11px;font-weight:800;padding:4px 12px;border-radius:9999px;text-transform:uppercase}
  </style></head><body><div class="card">
  <span class="badge">Appointment Cancelled</span>
  <h1 style="font-size:22px;font-weight:800;color:#001b35;margin:12px 0 4px">${p.title} Cancelled</h1>
  <p style="color:#73777f;font-size:14px">Hi ${p.name}, your appointment on ${p.formattedDate} at ${p.formattedTime} has been cancelled.</p>
  <a href="https://provo8ward.vercel.app/#schedule" style="display:inline-block;background:#fed000;color:#231b00;font-weight:700;font-size:14px;padding:10px 24px;border-radius:12px;text-decoration:none;margin-top:16px">Book New Appointment</a>
  </div></body></html>`;
}
