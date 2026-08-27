# Supabase Edge Function: Resend Email Deployment Guide

This guide walks you through deploying the `handle-appointment-email` Edge Function to your Supabase project to enable automated Resend emails (Instant Confirmation with `.ics` attachment, 24-hour reminder, 30-minute reminder, and auto-cancellation).

---

## 1. Prerequisites
- [Supabase CLI installed](https://supabase.com/docs/guides/cli) or use the Supabase Dashboard.
- A [Resend API Key](https://resend.com/api-keys) (`re_...`).
- A verified sender email / domain on Resend (or `onboarding@resend.dev` for testing).

---

## 2. Set Secrets in Supabase

Run the following commands in your terminal (or add them in **Supabase Dashboard > Project Settings > Edge Functions > Secrets**):

```bash
# Set your Resend API Key
supabase secrets set RESEND_API_KEY=re_your_api_key_here

# (Optional) Set your custom From email (default is onboarding@resend.dev)
supabase secrets set RESEND_FROM_EMAIL="Provo YSA 8th Ward <appointments@yourdomain.com>"
```

---

## 3. Deploy the Edge Function

From the project root directory, run:

```bash
supabase functions deploy handle-appointment-email --no-verify-jwt
```

> **Note**: `--no-verify-jwt` allows your public booking page to invoke the function seamlessly without requiring anonymous user authentication tokens.

---

## 4. How the Function Works

1. **`action: 'create'`**:
   - Sends an **instant confirmation email** with formatted details and the `.ics` calendar file attachment.
   - Calculates the timestamp for `start_time - 24 hours` and schedules the **24-hour reminder** via Resend's `scheduled_at` parameter.
   - Calculates the timestamp for `start_time - 30 minutes` and schedules the **30-minute reminder** via Resend's `scheduled_at` parameter.
   - Saves the returned `resend_24h_id` and `resend_30m_id` back to the appointment database row.

2. **`action: 'cancel'`**:
   - Calls `DELETE https://api.resend.com/emails/{id}` to automatically cancel scheduled 24h & 30m reminders so the attendee isn't reminded of a cancelled meeting.
   - Sends a friendly cancellation confirmation email.
