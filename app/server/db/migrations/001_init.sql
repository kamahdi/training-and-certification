-- Clinic Waiting Room, phase 1 schema. See docs/architecture.md › Data model.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE clinic (
  id                    smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  name                  text NOT NULL,
  address               text NOT NULL DEFAULT '',
  time_zone             text NOT NULL DEFAULT 'Europe/Brussels',
  default_language      text NOT NULL DEFAULT 'en',
  -- Settings the stories leave tunable (qa/test-strategy.md › Gaps: clinic settings)
  retention_days        integer NOT NULL DEFAULT 90,
  link_window_hours     integer NOT NULL DEFAULT 3,
  checkin_open_minutes  integer NOT NULL DEFAULT 60,
  estimate_before_min   integer NOT NULL DEFAULT 5,
  estimate_after_min    integer NOT NULL DEFAULT 10,
  default_consult_min   integer NOT NULL DEFAULT 15,
  delay_threshold_min   integer NOT NULL DEFAULT 15,
  idle_lock_minutes     integer NOT NULL DEFAULT 15
);

CREATE TABLE staff_user (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  email          text NOT NULL UNIQUE,
  role           text NOT NULL CHECK (role IN ('professional', 'reception', 'manager')),
  room           text,
  password_hash  text NOT NULL,
  active         boolean NOT NULL DEFAULT true
);

CREATE TABLE staff_session (
  token_hash     text PRIMARY KEY,
  staff_user_id  uuid NOT NULL REFERENCES staff_user(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL,
  last_seen_at   timestamptz NOT NULL,
  locked         boolean NOT NULL DEFAULT false
);

-- An appointment is who is expected and when. Walk-ins get an appointment row with starts_at NULL.
CREATE TABLE appointment (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id  uuid NOT NULL REFERENCES staff_user(id),
  starts_at        timestamptz,
  patient_name     text NOT NULL,
  phone            text,
  language         text,
  source           text NOT NULL CHECK (source IN ('file', 'walk_in', 'agenda')),
  source_key       text UNIQUE,
  cancelled_at     timestamptz,
  created_at       timestamptz NOT NULL
);

-- A visit is what happens on the day: links, status, flags, estimates.
CREATE TABLE visit (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id         uuid NOT NULL UNIQUE REFERENCES appointment(id) ON DELETE CASCADE,
  professional_id        uuid NOT NULL REFERENCES staff_user(id),
  trail_id               uuid NOT NULL DEFAULT gen_random_uuid(),
  kind                   text NOT NULL CHECK (kind IN ('booked', 'walk_in')),
  day                    date NOT NULL,
  status                 text NOT NULL DEFAULT 'booked'
                           CHECK (status IN ('booked', 'arrived', 'called', 'missed', 'done', 'cancelled')),
  link_token_hash        text NOT NULL UNIQUE,
  form_token_hash        text NOT NULL UNIQUE,
  form_link_active_from  timestamptz,
  emergency              boolean NOT NULL DEFAULT false,
  checkin_method         text CHECK (checkin_method IN ('qr', 'text_code', 'reception')),
  arrived_at             timestamptz,
  called_at              timestamptz,
  skip_count             integer NOT NULL DEFAULT 0,
  requeue_after_visit    uuid,
  shown_from             timestamptz,
  shown_to               timestamptz,
  slip_reason            text,
  delay_warned_lateness  integer,
  delay_corrections      integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL
);
CREATE INDEX visit_queue_idx ON visit (professional_id, day, status);

CREATE TABLE form_answers (
  visit_id         uuid PRIMARY KEY REFERENCES visit(id) ON DELETE CASCADE,
  reason_enc       text,
  medications_enc  text,
  fund_enc         text,
  member_enc       text,
  phone_enc        text,
  consent_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  submitted_at     timestamptz NOT NULL
);

CREATE TABLE recognized_phone (
  cookie_hash   text NOT NULL,
  visit_id      uuid NOT NULL REFERENCES visit(id) ON DELETE CASCADE,
  last_seen_at  timestamptz NOT NULL,
  PRIMARY KEY (cookie_hash, visit_id)
);

CREATE TABLE text_code (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash  text NOT NULL,
  code_hash   text NOT NULL,
  purpose     text NOT NULL CHECK (purpose IN ('checkin', 'export')),
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL
);
CREATE INDEX text_code_phone_idx ON text_code (phone_hash, purpose);

-- Append-only record of every step (ADR-005). trail_id survives erasure; visit_id does not.
CREATE TABLE event (
  id               bigserial PRIMARY KEY,
  trail_id         uuid,
  visit_id         uuid REFERENCES visit(id) ON DELETE SET NULL,
  professional_id  uuid,
  type             text NOT NULL,
  actor            text NOT NULL,
  at               timestamptz NOT NULL,
  details          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX event_prof_at_idx ON event (professional_id, at);
CREATE INDEX event_trail_idx ON event (trail_id);

CREATE TABLE message (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id     uuid REFERENCES visit(id) ON DELETE CASCADE,
  to_phone     text NOT NULL,
  template     text NOT NULL,
  language     text NOT NULL,
  body         text NOT NULL,      -- rendered with links and codes redacted
  vars         jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_id  text,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'cancelled')),
  error        text,
  created_at   timestamptz NOT NULL,
  sent_at      timestamptz
);

CREATE TABLE access_log (
  id             bigserial PRIMARY KEY,
  staff_user_id  uuid NOT NULL,
  staff_role     text NOT NULL,
  trail_id       uuid NOT NULL,   -- the visit's trail_id; after erasure it no longer resolves to a patient
  at             timestamptz NOT NULL
);
CREATE INDEX access_log_trail_idx ON access_log (trail_id);

-- Nobody may edit or delete access-log rows (WR-22).
CREATE FUNCTION access_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'access_log is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER access_log_no_update BEFORE UPDATE OR DELETE ON access_log
  FOR EACH ROW EXECUTE FUNCTION access_log_append_only();

-- Background jobs (ADR-003). Queued in the same transaction as the data that needs them.
CREATE TABLE job (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,
  run_at      timestamptz NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key  text UNIQUE,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  visit_id    uuid
);
CREATE INDEX job_pending_idx ON job (status, run_at);

CREATE TABLE queue_version (
  professional_id  uuid NOT NULL,
  day              date NOT NULL,
  version          integer NOT NULL DEFAULT 0,
  PRIMARY KEY (professional_id, day)
);

CREATE TABLE erasure_list (
  id          bigserial PRIMARY KEY,
  phone_hash  text NOT NULL,
  starts_at   timestamptz,
  created_at  timestamptz NOT NULL
);
CREATE INDEX erasure_list_idx ON erasure_list (phone_hash);

CREATE TABLE data_request (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL CHECK (kind IN ('erasure', 'export')),
  requested_at   timestamptz NOT NULL,
  completed_at   timestamptz,
  staff_user_id  uuid NOT NULL
);
