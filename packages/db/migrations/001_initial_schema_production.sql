-- Vaidya production schema - implementation baseline
-- PostgreSQL source of truth. Redis is not source of truth.
-- This schema is generated from the final updated Vaidya production LLD.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- =========================
-- Utility
-- =========================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================
-- Clinics and settings
-- =========================

CREATE TABLE clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  primary_phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text DEFAULT 'India',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  default_language_code text NOT NULL DEFAULT 'ta_tanglish',
  active boolean NOT NULL DEFAULT true,
  onboarding_status text NOT NULL DEFAULT 'setup_pending' CHECK (onboarding_status IN ('setup_pending','ready_for_agent','active','suspended','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id)
);

CREATE TABLE clinic_settings (
  clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE RESTRICT,
  agent_enabled boolean NOT NULL DEFAULT false,
  answering_mode text NOT NULL DEFAULT 'off' CHECK (answering_mode IN ('always_on','after_hours_only','overflow_after_n_rings','holiday_only','off')),
  fallback_phone text,
  overflow_after_rings integer CHECK (overflow_after_rings IS NULL OR overflow_after_rings > 0),
  booking_mode text NOT NULL DEFAULT 'pending_confirmation' CHECK (booking_mode IN ('pending_confirmation','auto_confirm')),
  max_concurrent_calls integer NOT NULL DEFAULT 1 CHECK (max_concurrent_calls > 0),
  recording_retention_days integer NOT NULL DEFAULT 10 CHECK (recording_retention_days BETWEEN 1 AND 30),
  transcript_retention_days integer NOT NULL DEFAULT 30 CHECK (transcript_retention_days BETWEEN 1 AND 180),
  notify_staff_on_pending_appointment boolean NOT NULL DEFAULT true,
  pending_appointment_notification_channel text CHECK (pending_appointment_notification_channel IS NULL OR pending_appointment_notification_channel IN ('dashboard','whatsapp','sms','email')),
  allow_doctor_service_edit boolean NOT NULL DEFAULT false,
  allow_patient_auto_cancel boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clinic_onboarding_checklist (
  clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE RESTRICT,
  clinic_details_done boolean NOT NULL DEFAULT false,
  admin_user_done boolean NOT NULL DEFAULT false,
  clinic_hours_done boolean NOT NULL DEFAULT false,
  doctors_done boolean NOT NULL DEFAULT false,
  services_done boolean NOT NULL DEFAULT false,
  doctor_service_mapping_done boolean NOT NULL DEFAULT false,
  doctor_schedules_done boolean NOT NULL DEFAULT false,
  booking_rules_done boolean NOT NULL DEFAULT false,
  knowledge_base_done boolean NOT NULL DEFAULT false,
  notification_setup_done boolean NOT NULL DEFAULT false,
  telephony_setup_done boolean NOT NULL DEFAULT false,
  test_conversation_done boolean NOT NULL DEFAULT false,
  ready_for_agent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clinic_telephony_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('exotel','twilio','other')),
  provider_account_id text,
  provider_number text,
  fallback_phone text,
  incoming_webhook_secret text,
  recording_enabled boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, provider, provider_number),
  UNIQUE (clinic_id, id)
);

-- =========================
-- Auth and membership
-- =========================

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider_id text UNIQUE,
  name text,
  email text UNIQUE,
  phone text UNIQUE,
  platform_role text CHECK (platform_role IS NULL OR platform_role IN ('platform_admin','support','none')),
  active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE clinic_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('clinic_admin','doctor')),
  doctor_id uuid,
  active boolean NOT NULL DEFAULT true,
  invited_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, user_id),
  UNIQUE (clinic_id, id)
);

CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  otp_hash text NOT NULL,
  purpose text NOT NULL DEFAULT 'login' CHECK (purpose IN ('login','invite_accept','passwordless_login')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- Subscriptions and usage - least priority but schema-ready
-- =========================

CREATE TABLE subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly','manual')),
  currency text NOT NULL DEFAULT 'INR',
  base_price numeric(12,2) NOT NULL DEFAULT 0,
  included_voice_minutes integer NOT NULL DEFAULT 0,
  included_sms_count integer NOT NULL DEFAULT 0,
  included_whatsapp_count integer NOT NULL DEFAULT 0,
  max_concurrent_calls integer NOT NULL DEFAULT 1,
  max_doctors integer,
  max_admin_users integer,
  max_knowledge_items integer,
  recording_retention_days integer NOT NULL DEFAULT 10,
  transcript_retention_days integer NOT NULL DEFAULT 30,
  auto_confirm_allowed boolean NOT NULL DEFAULT false,
  voice_enabled boolean NOT NULL DEFAULT false,
  whatsapp_notifications_enabled boolean NOT NULL DEFAULT true,
  custom_plan boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clinic_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  subscription_plan_id uuid REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('trialing','active','past_due','cancelled','expired','manual_free')),
  billing_provider text,
  external_customer_id text,
  external_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  cancel_at timestamptz,
  cancelled_at timestamptz,
  plan_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id)
);

CREATE TABLE clinic_usage_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  billing_month date NOT NULL,
  voice_call_count integer NOT NULL DEFAULT 0,
  voice_minutes_used numeric(12,2) NOT NULL DEFAULT 0,
  stt_minutes_used numeric(12,2) NOT NULL DEFAULT 0,
  tts_characters_used integer NOT NULL DEFAULT 0,
  sms_sent_count integer NOT NULL DEFAULT 0,
  whatsapp_sent_count integer NOT NULL DEFAULT 0,
  appointment_requests_created integer NOT NULL DEFAULT 0,
  confirmed_appointments integer NOT NULL DEFAULT 0,
  callback_requests_created integer NOT NULL DEFAULT 0,
  recording_storage_gb numeric(12,4) NOT NULL DEFAULT 0,
  overage_voice_minutes numeric(12,2) NOT NULL DEFAULT 0,
  overage_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, billing_month)
);

CREATE TABLE subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  clinic_subscription_id uuid REFERENCES clinic_subscriptions(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  old_plan_id uuid REFERENCES subscription_plans(id) ON DELETE SET NULL,
  new_plan_id uuid REFERENCES subscription_plans(id) ON DELETE SET NULL,
  event_data_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- Languages and templates
-- =========================

CREATE TABLE supported_languages (
  language_code text PRIMARY KEY,
  display_name text NOT NULL,
  native_name text,
  enabled_platform_wide boolean NOT NULL DEFAULT true,
  default_tts_voice text,
  default_stt_language_hint text,
  fallback_language_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clinic_languages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  language_code text NOT NULL REFERENCES supported_languages(language_code) ON DELETE RESTRICT,
  is_default boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, language_code)
);

CREATE TABLE message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  language_code text NOT NULL REFERENCES supported_languages(language_code) ON DELETE RESTRICT,
  template_text text NOT NULL,
  required_variables_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_key, language_code)
);

CREATE TABLE language_packs (
  language_code text PRIMARY KEY REFERENCES supported_languages(language_code) ON DELETE RESTRICT,
  yes_words_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  no_words_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  today_words_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  tomorrow_words_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  time_preference_words_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  classifier_examples_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- Doctors, services, schedules, booking rules
-- =========================

CREATE TABLE doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL,
  qualification text,
  registration_number text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id)
);

ALTER TABLE clinic_users
  ADD CONSTRAINT clinic_users_doctor_fk
  FOREIGN KEY (clinic_id, doctor_id) REFERENCES doctors(clinic_id, id) ON DELETE SET NULL;

CREATE TABLE clinic_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  service_key text NOT NULL,
  service_name text NOT NULL,
  description text,
  handles_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  does_not_handle_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  red_flags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  routing_examples_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_staff_confirmation boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, service_key),
  UNIQUE (clinic_id, id)
);

CREATE TABLE doctor_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  doctor_id uuid NOT NULL,
  clinic_service_id uuid NOT NULL,
  consultation_fee_amount numeric(12,2),
  followup_fee_amount numeric(12,2),
  followup_valid_days integer CHECK (followup_valid_days IS NULL OR followup_valid_days >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, doctor_id, clinic_service_id),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, doctor_id) REFERENCES doctors(clinic_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (clinic_id, clinic_service_id) REFERENCES clinic_services(clinic_id, id) ON DELETE RESTRICT
);

CREATE TABLE doctor_service_booking_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  doctor_id uuid NOT NULL,
  clinic_service_id uuid NOT NULL,
  slot_duration_minutes integer NOT NULL CHECK (slot_duration_minutes > 0),
  capacity_per_slot integer NOT NULL CHECK (capacity_per_slot > 0),
  booking_horizon_days integer NOT NULL DEFAULT 45 CHECK (booking_horizon_days BETWEEN 1 AND 180),
  min_booking_notice_minutes integer NOT NULL DEFAULT 0 CHECK (min_booking_notice_minutes >= 0),
  max_advance_booking_days integer CHECK (max_advance_booking_days IS NULL OR max_advance_booking_days > 0),
  manual_edit_cutoff_before_start_minutes integer NOT NULL DEFAULT 60 CHECK (manual_edit_cutoff_before_start_minutes >= 0),
  manual_edit_max_shift_minutes integer NOT NULL DEFAULT 60 CHECK (manual_edit_max_shift_minutes >= 0),
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, doctor_id, clinic_service_id, version),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, doctor_id) REFERENCES doctors(clinic_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (clinic_id, clinic_service_id) REFERENCES clinic_services(clinic_id, id) ON DELETE RESTRICT,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE clinic_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  CHECK (end_time > start_time)
);

CREATE TABLE clinic_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  holiday_date date NOT NULL,
  is_full_day boolean NOT NULL DEFAULT true,
  start_time time,
  end_time time,
  reason text,
  active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  CHECK (is_full_day OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time))
);

CREATE TABLE clinic_holiday_doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  holiday_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  UNIQUE (clinic_id, holiday_id, doctor_id),
  FOREIGN KEY (clinic_id, holiday_id) REFERENCES clinic_holidays(clinic_id, id) ON DELETE CASCADE,
  FOREIGN KEY (clinic_id, doctor_id) REFERENCES doctors(clinic_id, id) ON DELETE RESTRICT
);

CREATE TABLE doctor_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  doctor_id uuid NOT NULL,
  doctor_service_id uuid,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  effective_from date,
  effective_to date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, doctor_id) REFERENCES doctors(clinic_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (clinic_id, doctor_service_id) REFERENCES doctor_services(clinic_id, id) ON DELETE RESTRICT,
  CHECK (end_time > start_time),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE TABLE doctor_blocked_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  doctor_id uuid NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  reason text,
  active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, doctor_id) REFERENCES doctors(clinic_id, id) ON DELETE RESTRICT,
  CHECK (end_time > start_time)
);

-- =========================
-- Appointment slots and requests
-- =========================

CREATE TABLE generated_slot_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  trigger_source text NOT NULL CHECK (trigger_source IN ('daily_job','schedule_change','rule_change','holiday_change','manual')),
  rule_id uuid REFERENCES doctor_service_booking_rules(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id)
);

CREATE TABLE appointment_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  doctor_id uuid NOT NULL,
  clinic_service_id uuid NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  capacity_total integer NOT NULL CHECK (capacity_total > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','blocked','cancelled','superseded')),
  generated_from_rule_id uuid REFERENCES doctor_service_booking_rules(id) ON DELETE SET NULL,
  generation_batch_id uuid REFERENCES generated_slot_batches(id) ON DELETE SET NULL,
  config_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, doctor_id) REFERENCES doctors(clinic_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (clinic_id, clinic_service_id) REFERENCES clinic_services(clinic_id, id) ON DELETE RESTRICT,
  CHECK (end_time > start_time)
);

-- No duplicate active slot identity for same doctor-service time window.
CREATE UNIQUE INDEX appointment_slots_unique_active_window
ON appointment_slots (clinic_id, doctor_id, clinic_service_id, start_time, end_time)
WHERE status <> 'superseded';

CREATE TABLE slot_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  slot_id uuid NOT NULL,
  session_id uuid,
  patient_phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','released','converted')),
  hold_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, slot_id) REFERENCES appointment_slots(clinic_id, id) ON DELETE RESTRICT
);

CREATE TABLE patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  name text NOT NULL,
  normalized_name text,
  phone text,
  normalized_phone text,
  age_years integer,
  date_of_birth date,
  gender text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id)
);

CREATE UNIQUE INDEX patients_unique_phone_name_age_nodob
ON patients (clinic_id, normalized_phone, normalized_name, age_years)
WHERE normalized_phone IS NOT NULL
  AND normalized_name IS NOT NULL
  AND age_years IS NOT NULL
  AND date_of_birth IS NULL;

CREATE UNIQUE INDEX patients_unique_phone_name_age_dob
ON patients (clinic_id, normalized_phone, normalized_name, age_years, date_of_birth)
WHERE normalized_phone IS NOT NULL
  AND normalized_name IS NOT NULL
  AND age_years IS NOT NULL
  AND date_of_birth IS NOT NULL;

CREATE TABLE appointment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  slot_id uuid,
  slot_hold_id uuid,
  patient_id uuid,
  patient_name text NOT NULL,
  patient_phone text,
  doctor_id uuid NOT NULL,
  clinic_service_id uuid NOT NULL,
  reason_for_visit text NOT NULL,
  normalized_reason text,
  appointment_start timestamptz NOT NULL,
  appointment_end timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_confirmation','confirmed','visited','cancelled','rescheduled','no_show','conflict_required')),
  is_followup boolean NOT NULL DEFAULT false,
  followup_of_visit_id uuid,
  routing_source text CHECK (routing_source IS NULL OR routing_source IN ('service_router','returning_patient_followup','doctor_name','manual','admin_action')),
  source_session_id uuid,
  replaces_appointment_id uuid,
  replaced_by_appointment_id uuid,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, slot_id) REFERENCES appointment_slots(clinic_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (clinic_id, slot_hold_id) REFERENCES slot_holds(clinic_id, id) ON DELETE SET NULL,
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id) ON DELETE SET NULL,
  FOREIGN KEY (clinic_id, doctor_id) REFERENCES doctors(clinic_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (clinic_id, clinic_service_id) REFERENCES clinic_services(clinic_id, id) ON DELETE RESTRICT,
  CHECK (appointment_end > appointment_start)
);

CREATE TABLE appointment_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  appointment_id uuid NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('cancel','reschedule')),
  requested_by text NOT NULL CHECK (requested_by IN ('patient_call','admin','doctor')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','completed')),
  requested_new_slot_id uuid,
  requested_new_date date,
  requested_new_time_preference text,
  reason text,
  source_call_id uuid,
  source_session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, appointment_id) REFERENCES appointment_requests(clinic_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (clinic_id, requested_new_slot_id) REFERENCES appointment_slots(clinic_id, id) ON DELETE SET NULL
);

CREATE TABLE appointment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  appointment_request_id uuid NOT NULL,
  event_type text NOT NULL,
  old_values_json jsonb,
  new_values_json jsonb,
  actor_type text NOT NULL CHECK (actor_type IN ('agent','clinic_admin','doctor','system','patient_call','platform_admin')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source_session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (clinic_id, appointment_request_id) REFERENCES appointment_requests(clinic_id, id) ON DELETE RESTRICT
);

CREATE TABLE patient_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL,
  appointment_request_id uuid,
  doctor_id uuid NOT NULL,
  clinic_service_id uuid NOT NULL,
  reason_for_visit text NOT NULL,
  normalized_reason text,
  visited_at timestamptz NOT NULL,
  followup_valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (clinic_id, appointment_request_id) REFERENCES appointment_requests(clinic_id, id) ON DELETE SET NULL,
  FOREIGN KEY (clinic_id, doctor_id) REFERENCES doctors(clinic_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (clinic_id, clinic_service_id) REFERENCES clinic_services(clinic_id, id) ON DELETE RESTRICT
);

-- =========================
-- Conversations
-- =========================

CREATE TABLE conversation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('web_demo','voice_call','whatsapp','admin_test')),
  patient_phone text,
  patient_id uuid,
  language_code text NOT NULL DEFAULT 'ta_tanglish' REFERENCES supported_languages(language_code) ON DELETE RESTRICT,
  language_source text CHECK (language_source IS NULL OR language_source IN ('clinic_default','patient_requested','detected')),
  current_flow text NOT NULL DEFAULT 'none' CHECK (current_flow IN ('none','booking','cancel','reschedule','handoff','emergency','fee_clarification')),
  current_state text NOT NULL DEFAULT 'IDLE',
  collected_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','escalated','abandoned','expired')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id) ON DELETE SET NULL
);

ALTER TABLE slot_holds
  ADD CONSTRAINT slot_holds_session_fk
  FOREIGN KEY (clinic_id, session_id) REFERENCES conversation_sessions(clinic_id, id) ON DELETE SET NULL;

ALTER TABLE appointment_requests
  ADD CONSTRAINT appointment_requests_source_session_fk
  FOREIGN KEY (clinic_id, source_session_id) REFERENCES conversation_sessions(clinic_id, id) ON DELETE SET NULL;

ALTER TABLE appointment_action_requests
  ADD CONSTRAINT appointment_action_requests_source_session_fk
  FOREIGN KEY (clinic_id, source_session_id) REFERENCES conversation_sessions(clinic_id, id) ON DELETE SET NULL;

CREATE TABLE conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  sender text NOT NULL CHECK (sender IN ('patient','assistant','system')),
  message_text text NOT NULL,
  intent text,
  reply_template_key text,
  flow_before text,
  state_before text,
  flow_after text,
  state_after text,
  debug_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (clinic_id, session_id) REFERENCES conversation_sessions(clinic_id, id) ON DELETE RESTRICT
);

CREATE TABLE message_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  session_id uuid,
  idempotency_key text NOT NULL,
  request_hash text,
  response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, idempotency_key),
  FOREIGN KEY (clinic_id, session_id) REFERENCES conversation_sessions(clinic_id, id) ON DELETE SET NULL
);

-- =========================
-- Calls, transcripts, callback and emergency
-- =========================

CREATE TABLE calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  session_id uuid,
  patient_phone text,
  patient_id uuid,
  provider text,
  provider_call_id text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  outcome text,
  summary text,
  recording_url text,
  recording_storage_key text,
  recording_expires_at timestamptz,
  recording_deleted_at timestamptz,
  transcript_expires_at timestamptz,
  created_appointment_request_id uuid,
  created_callback_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, session_id) REFERENCES conversation_sessions(clinic_id, id) ON DELETE SET NULL,
  FOREIGN KEY (clinic_id, patient_id) REFERENCES patients(clinic_id, id) ON DELETE SET NULL,
  FOREIGN KEY (clinic_id, created_appointment_request_id) REFERENCES appointment_requests(clinic_id, id) ON DELETE SET NULL
);

ALTER TABLE appointment_action_requests
  ADD CONSTRAINT appointment_action_requests_source_call_fk
  FOREIGN KEY (clinic_id, source_call_id) REFERENCES calls(clinic_id, id) ON DELETE SET NULL;

CREATE TABLE call_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  call_id uuid NOT NULL,
  speaker text NOT NULL CHECK (speaker IN ('patient','assistant','system')),
  transcript_text text NOT NULL,
  started_at_ms integer,
  ended_at_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (clinic_id, call_id) REFERENCES calls(clinic_id, id) ON DELETE RESTRICT
);

CREATE TABLE callback_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  patient_name text,
  patient_phone text,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
  source_session_id uuid,
  source_call_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, source_session_id) REFERENCES conversation_sessions(clinic_id, id) ON DELETE SET NULL,
  FOREIGN KEY (clinic_id, source_call_id) REFERENCES calls(clinic_id, id) ON DELETE SET NULL
);

ALTER TABLE calls
  ADD CONSTRAINT calls_created_callback_fk
  FOREIGN KEY (clinic_id, created_callback_request_id) REFERENCES callback_requests(clinic_id, id) ON DELETE SET NULL;

CREATE TABLE emergency_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  patient_phone text,
  patient_name text,
  message_text text,
  detected_reason text,
  source_session_id uuid,
  source_call_id uuid,
  status text NOT NULL DEFAULT 'alert_created' CHECK (status IN ('alert_created','acknowledged','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, source_session_id) REFERENCES conversation_sessions(clinic_id, id) ON DELETE SET NULL,
  FOREIGN KEY (clinic_id, source_call_id) REFERENCES calls(clinic_id, id) ON DELETE SET NULL
);

-- =========================
-- Knowledge base
-- =========================

CREATE TABLE knowledge_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  file_name text NOT NULL,
  file_type text NOT NULL,
  storage_key text,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','processing','processed','failed')),
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id)
);

CREATE TABLE clinic_knowledge_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  question text NOT NULL,
  answer text NOT NULL,
  category text,
  alternative_phrases_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_file_id uuid,
  source_file text,
  source_page integer,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','disabled','needs_update')),
  search_text text,
  embedding vector(768),
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id),
  FOREIGN KEY (clinic_id, source_file_id) REFERENCES knowledge_files(clinic_id, id) ON DELETE SET NULL
);

CREATE TABLE clinic_knowledge_translations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  knowledge_id uuid NOT NULL,
  language_code text NOT NULL REFERENCES supported_languages(language_code) ON DELETE RESTRICT,
  translated_question text,
  translated_answer text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','disabled','needs_update')),
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, knowledge_id, language_code),
  FOREIGN KEY (clinic_id, knowledge_id) REFERENCES clinic_knowledge_base(clinic_id, id) ON DELETE RESTRICT
);

-- =========================
-- Notifications and audit
-- =========================

CREATE TABLE notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  recipient_type text NOT NULL CHECK (recipient_type IN ('patient','clinic_admin','doctor','platform_admin')),
  recipient_phone text,
  recipient_email text,
  channel text NOT NULL CHECK (channel IN ('whatsapp','sms','email','dashboard')),
  template_key text,
  language_code text REFERENCES supported_languages(language_code) ON DELETE SET NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  deduplication_key text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed','cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  provider_response_json jsonb,
  last_error text,
  scheduled_at timestamptz DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, id)
);

CREATE UNIQUE INDEX notification_events_dedup_idx
ON notification_events (clinic_id, deduplication_key)
WHERE deduplication_key IS NOT NULL;

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid REFERENCES clinics(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('platform_admin','clinic_admin','doctor','agent','system','patient_call')),
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  old_values_json jsonb,
  new_values_json jsonb,
  event_data_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================
-- Indexes
-- =========================

CREATE INDEX idx_clinic_users_clinic_role_active ON clinic_users (clinic_id, role, active);
CREATE INDEX idx_doctors_clinic_active ON doctors (clinic_id, active);
CREATE INDEX idx_clinic_services_clinic_active ON clinic_services (clinic_id, active);
CREATE INDEX idx_doctor_services_service_active ON doctor_services (clinic_id, clinic_service_id, active);
CREATE INDEX idx_doctor_schedules_lookup ON doctor_schedules (clinic_id, doctor_id, day_of_week, active);
CREATE INDEX idx_clinic_hours_lookup ON clinic_hours (clinic_id, day_of_week, active);
CREATE INDEX idx_clinic_holidays_lookup ON clinic_holidays (clinic_id, holiday_date, active);
CREATE INDEX idx_clinic_holiday_doctors_lookup ON clinic_holiday_doctors (clinic_id, holiday_id, doctor_id);
CREATE INDEX idx_appointment_slots_lookup ON appointment_slots (clinic_id, doctor_id, clinic_service_id, start_time, status);
CREATE INDEX idx_slot_holds_lookup ON slot_holds (clinic_id, slot_id, status, hold_expires_at);
CREATE INDEX idx_slot_holds_session ON slot_holds (session_id, status);
CREATE INDEX idx_patients_phone ON patients (clinic_id, normalized_phone);
CREATE INDEX idx_appointments_doctor_time ON appointment_requests (clinic_id, doctor_id, appointment_start);
CREATE INDEX idx_appointments_phone_time ON appointment_requests (clinic_id, patient_phone, appointment_start);
CREATE INDEX idx_appointments_status_time ON appointment_requests (clinic_id, status, appointment_start);
CREATE INDEX idx_action_requests_status ON appointment_action_requests (clinic_id, status, created_at DESC);
CREATE INDEX idx_patient_visits_patient_time ON patient_visits (clinic_id, patient_id, visited_at DESC);
CREATE INDEX idx_conversation_sessions_phone ON conversation_sessions (clinic_id, patient_phone, created_at DESC);
CREATE INDEX idx_conversation_messages_session ON conversation_messages (clinic_id, session_id, created_at);
CREATE INDEX idx_calls_clinic_time ON calls (clinic_id, started_at DESC);
CREATE INDEX idx_call_transcripts_call ON call_transcripts (clinic_id, call_id, created_at);
CREATE INDEX idx_knowledge_status_category ON clinic_knowledge_base (clinic_id, status, category);
CREATE INDEX idx_knowledge_search_trgm ON clinic_knowledge_base USING gin (search_text gin_trgm_ops);
CREATE INDEX idx_notifications_status ON notification_events (status, scheduled_at);
CREATE INDEX idx_audit_clinic_time ON audit_logs (clinic_id, created_at DESC);

-- Updated_at triggers
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN (
    'clinics','clinic_settings','clinic_onboarding_checklist','clinic_telephony_settings','users','clinic_users',
    'subscription_plans','clinic_subscriptions','clinic_usage_monthly','supported_languages','clinic_languages',
    'message_templates','language_packs','doctors','clinic_services','doctor_services','doctor_service_booking_rules',
    'clinic_hours','clinic_holidays','clinic_holiday_doctors','doctor_schedules','doctor_blocked_slots','appointment_slots','slot_holds',
    'patients','appointment_requests','appointment_action_requests','patient_visits','conversation_sessions',
    'calls','callback_requests','emergency_incidents','knowledge_files','clinic_knowledge_base','clinic_knowledge_translations',
    'notification_events'
  ) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', r.tablename, r.tablename);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', r.tablename, r.tablename);
  END LOOP;
END $$;

COMMIT;
