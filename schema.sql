-- ============================================================
-- Ward Meeting Scheduling System — Database Schema
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================
-- 1. Meeting Types
--    Defines the kinds of appointments available for booking
-- ============================================================
CREATE TABLE IF NOT EXISTS meeting_types (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT        NOT NULL,
  description      TEXT,
  duration_minutes INT         NOT NULL,
  buffer_minutes   INT         DEFAULT 0,
  assigned_to      TEXT        DEFAULT 'Bishopric',
  is_active        BOOLEAN     DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Seed 7 Standard Meeting Types
INSERT INTO meeting_types (title, description, duration_minutes, buffer_minutes, assigned_to, is_active)
SELECT 'Ecclesiastical Endorsement', 'Please schedule your meeting for the earliest available time to prevent gaps. Submit your endorsement before your appointment. Thank you! https://honorcode.byu.edu/ecclesiastical-endorsements-and-resources', 15, 0, 'Bishopric', true
WHERE NOT EXISTS (SELECT 1 FROM meeting_types WHERE title = 'Ecclesiastical Endorsement');

INSERT INTO meeting_types (title, description, duration_minutes, buffer_minutes, assigned_to, is_active)
SELECT 'Temple Recommend Renewal', 'If you have been in the ward for more than a year, please contact one of the secretaries for a temple recommend renewal. Also, please schedule your meeting for the earliest available time to prevent gaps, thank you!', 15, 0, 'Bishopric', true
WHERE NOT EXISTS (SELECT 1 FROM meeting_types WHERE title = 'Temple Recommend Renewal');

INSERT INTO meeting_types (title, description, duration_minutes, buffer_minutes, assigned_to, is_active)
SELECT 'Temple Recommend for Own Endowment', 'Please schedule an interview with the stake before scheduling with the bishop. Also, please schedule your meeting for the earliest available time to prevent gaps, thank you!', 45, 0, 'Bishop', true
WHERE NOT EXISTS (SELECT 1 FROM meeting_types WHERE title = 'Temple Recommend for Own Endowment');

INSERT INTO meeting_types (title, description, duration_minutes, buffer_minutes, assigned_to, is_active)
SELECT 'Temple Recommend for Own Sealing', 'Please schedule an interview with the stake before scheduling with the bishop. Also, please schedule your meeting for the earliest available time to prevent gaps, thank you!', 45, 0, 'Bishop', true
WHERE NOT EXISTS (SELECT 1 FROM meeting_types WHERE title = 'Temple Recommend for Own Sealing');

INSERT INTO meeting_types (title, description, duration_minutes, buffer_minutes, assigned_to, is_active)
SELECT '15 Minute Personal Meeting', 'Please schedule your meeting for the earliest available time to prevent gaps, thank you!', 15, 0, 'Bishop', true
WHERE NOT EXISTS (SELECT 1 FROM meeting_types WHERE title = '15 Minute Personal Meeting');

INSERT INTO meeting_types (title, description, duration_minutes, buffer_minutes, assigned_to, is_active)
SELECT '30 Minute Personal Meeting', 'Please schedule your meeting for the earliest available time to prevent gaps, thank you!', 30, 0, 'Bishop', true
WHERE NOT EXISTS (SELECT 1 FROM meeting_types WHERE title = '30 Minute Personal Meeting');

INSERT INTO meeting_types (title, description, duration_minutes, buffer_minutes, assigned_to, is_active)
SELECT '45 Minute Personal Meeting', 'Please schedule your meeting for the earliest available time to prevent gaps, thank you!', 45, 0, 'Bishop', true
WHERE NOT EXISTS (SELECT 1 FROM meeting_types WHERE title = '45 Minute Personal Meeting');

-- ============================================================
-- 2. Weekly Recurring Availability
--    Supports multiple non-overlapping time windows per day
-- ============================================================
CREATE TABLE IF NOT EXISTS weekly_availability (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  day_of_week  INT  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time   TIME NOT NULL,  -- e.g. '10:00:00'
  end_time     TIME NOT NULL   -- e.g. '11:00:00'
);

-- Seed Default Availability (Sundays 1:00 PM - 3:00 PM, Wednesdays & Thursdays 6:30 PM - 8:30 PM)
INSERT INTO weekly_availability (day_of_week, start_time, end_time)
SELECT 0, '13:00:00', '15:00:00'
WHERE NOT EXISTS (SELECT 1 FROM weekly_availability WHERE day_of_week = 0);

INSERT INTO weekly_availability (day_of_week, start_time, end_time)
SELECT 3, '18:30:00', '20:30:00'
WHERE NOT EXISTS (SELECT 1 FROM weekly_availability WHERE day_of_week = 3);

INSERT INTO weekly_availability (day_of_week, start_time, end_time)
SELECT 4, '18:30:00', '20:30:00'
WHERE NOT EXISTS (SELECT 1 FROM weekly_availability WHERE day_of_week = 4);

-- ============================================================
-- 3. Date Overrides
--    Custom hours for a specific date, or mark it unavailable
-- ============================================================
CREATE TABLE IF NOT EXISTS date_overrides (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  override_date  DATE    NOT NULL,
  is_unavailable BOOLEAN DEFAULT false,
  start_time     TIME,   -- NULL when is_unavailable = true
  end_time       TIME    -- NULL when is_unavailable = true
);

-- ============================================================
-- 4. Ward Scheduling Settings
--    Global toggles and metadata for the scheduling system
-- ============================================================
CREATE TABLE IF NOT EXISTS ward_scheduling_settings (
  id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_name               TEXT    DEFAULT 'Provo YSA 8th Ward',
  accepting_appointments  BOOLEAN DEFAULT true,
  timezone                TEXT    DEFAULT 'America/Denver'
);

-- Seed one default settings row
INSERT INTO ward_scheduling_settings (ward_name, accepting_appointments, timezone)
SELECT 'Provo YSA 8th Ward', true, 'America/Denver'
WHERE NOT EXISTS (SELECT 1 FROM ward_scheduling_settings);

-- ============================================================
-- 5. Booked Appointments
--    Core booking record with cancellation tokens and
--    Resend scheduled-email IDs for future reminder management
-- ============================================================
CREATE TABLE IF NOT EXISTS appointments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_type_id  UUID        REFERENCES meeting_types(id) ON DELETE SET NULL,
  attendee_name    TEXT        NOT NULL,
  attendee_email   TEXT        NOT NULL,
  attendee_phone   TEXT,
  notes            TEXT,
  start_time       TIMESTAMPTZ NOT NULL,
  end_time         TIMESTAMPTZ NOT NULL,
  status           TEXT        DEFAULT 'confirmed'
                               CHECK (status IN ('confirmed', 'cancelled')),
  -- Opaque UUID token embedded in self-service cancel / reschedule links
  cancel_token     UUID        DEFAULT gen_random_uuid() UNIQUE,
  resend_24h_id    TEXT,
  resend_30m_id    TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Reminder tracking (set when the 24h / 30m reminder email has been sent,
-- so the cron job doesn't send duplicates)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_30m_sent_at TIMESTAMPTZ;

-- ============================================================
-- 5b. Admin Push Subscriptions
--     Web Push endpoints for admins who opted into new-appointment
--     notifications while signed into the leadership dashboard
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE admin_push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public insert admin_push_subscriptions" ON admin_push_subscriptions;
CREATE POLICY "Public insert admin_push_subscriptions" ON admin_push_subscriptions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Public select admin_push_subscriptions" ON admin_push_subscriptions;
CREATE POLICY "Public select admin_push_subscriptions" ON admin_push_subscriptions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Public delete admin_push_subscriptions" ON admin_push_subscriptions;
CREATE POLICY "Public delete admin_push_subscriptions" ON admin_push_subscriptions FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 5c. Site Push Subscriptions
--     Web Push endpoints for anyone who opened the site as a home-screen
--     app. `email` is set once they book an appointment (used to target
--     appointment reminders); it's NULL for installs that haven't booked
--     yet. Admin broadcast announcements go out to every row regardless
--     of whether email is set.
-- ============================================================
CREATE TABLE IF NOT EXISTS attendee_push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- If this table was created before email became optional, relax it now.
ALTER TABLE attendee_push_subscriptions ALTER COLUMN email DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attendee_push_subscriptions_email ON attendee_push_subscriptions (lower(email));

ALTER TABLE attendee_push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public insert attendee_push_subscriptions" ON attendee_push_subscriptions;
CREATE POLICY "Public insert attendee_push_subscriptions" ON attendee_push_subscriptions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Public select attendee_push_subscriptions" ON attendee_push_subscriptions;
CREATE POLICY "Public select attendee_push_subscriptions" ON attendee_push_subscriptions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Public delete attendee_push_subscriptions" ON attendee_push_subscriptions;
CREATE POLICY "Public delete attendee_push_subscriptions" ON attendee_push_subscriptions FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- 6. Overlap Guard
--    Prevents two confirmed appointments from occupying the
--    same time range using a GiST exclusion constraint
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'no_overlapping_appointments'
  ) THEN
    ALTER TABLE appointments
    ADD CONSTRAINT no_overlapping_appointments
    EXCLUDE USING gist (
      tstzrange(start_time, end_time) WITH &&
    ) WHERE (status = 'confirmed');
  END IF;
END $$;

-- ============================================================
-- 7. Row Level Security (RLS) & Permissions
--    Allows public web client (anon) & leadership to access tables
-- ============================================================
ALTER TABLE meeting_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE date_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE ward_scheduling_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- Meeting Types Policies
DROP POLICY IF EXISTS "Public select meeting_types" ON meeting_types;
CREATE POLICY "Public select meeting_types" ON meeting_types FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Public modify meeting_types" ON meeting_types;
CREATE POLICY "Public modify meeting_types" ON meeting_types FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Weekly Availability Policies
DROP POLICY IF EXISTS "Public select weekly_availability" ON weekly_availability;
CREATE POLICY "Public select weekly_availability" ON weekly_availability FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Public modify weekly_availability" ON weekly_availability;
CREATE POLICY "Public modify weekly_availability" ON weekly_availability FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Date Overrides Policies
DROP POLICY IF EXISTS "Public select date_overrides" ON date_overrides;
CREATE POLICY "Public select date_overrides" ON date_overrides FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Public modify date_overrides" ON date_overrides;
CREATE POLICY "Public modify date_overrides" ON date_overrides FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Settings Policies
DROP POLICY IF EXISTS "Public select settings" ON ward_scheduling_settings;
CREATE POLICY "Public select settings" ON ward_scheduling_settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Public modify settings" ON ward_scheduling_settings;
CREATE POLICY "Public modify settings" ON ward_scheduling_settings FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Appointments Policies (Public insert, read, update, delete)
DROP POLICY IF EXISTS "Public insert appointments" ON appointments;
CREATE POLICY "Public insert appointments" ON appointments FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Public select appointments" ON appointments;
CREATE POLICY "Public select appointments" ON appointments FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Public update appointments" ON appointments;
CREATE POLICY "Public update appointments" ON appointments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Public delete appointments" ON appointments;
CREATE POLICY "Public delete appointments" ON appointments FOR DELETE TO anon, authenticated USING (true);

-- Grant schema permissions to anon and authenticated roles
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
