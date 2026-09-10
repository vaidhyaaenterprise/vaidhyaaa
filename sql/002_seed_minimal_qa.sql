-- Vaidya minimal QA seed data
-- Run after 001_initial_schema_production.sql

BEGIN;

INSERT INTO supported_languages (language_code, display_name, native_name, enabled_platform_wide, fallback_language_code)
VALUES
  ('ta_tanglish', 'Tanglish', 'Tamil + English', true, 'english'),
  ('english', 'English', 'English', true, 'ta_tanglish')
ON CONFLICT (language_code) DO NOTHING;

INSERT INTO language_packs (language_code, yes_words_json, no_words_json, today_words_json, tomorrow_words_json, time_preference_words_json, classifier_examples_json)
VALUES
('ta_tanglish',
 '["seri","sari","okay","ok","aama","confirm","pannunga"]',
 '["vendam","venam","venda","no","cancel","stop","later"]',
 '["inniku","inaiku","today","indru"]',
 '["naalaikku","nalaki","tomorrow"]',
 '{"morning":["morning","kaalai"],"afternoon":["afternoon","madhiyanam"],"evening":["evening","maalai"]}',
 '["Naalaikku evening appointment venum","Dr Priya fees evlo?","Fever-ku enna tablet?"]'
),
('english',
 '["yes","okay","ok","confirm","sure"]',
 '["no","no thanks","cancel","stop","later"]',
 '["today"]',
 '["tomorrow"]',
 '{"morning":["morning"],"afternoon":["afternoon"],"evening":["evening"]}',
 '["I need an appointment tomorrow evening","What is Dr Priya fee?","What tablet for fever?"]'
)
ON CONFLICT (language_code) DO UPDATE SET updated_at = now();

INSERT INTO subscription_plans (plan_key, name, billing_cycle, base_price, included_voice_minutes, max_concurrent_calls, max_doctors, recording_retention_days, transcript_retention_days, auto_confirm_allowed, voice_enabled, custom_plan)
VALUES
  ('pilot', 'Pilot', 'manual', 0, 500, 1, 5, 10, 30, false, false, true),
  ('starter', 'Starter', 'monthly', 2499, 500, 1, 3, 10, 30, false, true, false),
  ('pro', 'Pro', 'monthly', 5999, 1500, 3, 10, 10, 30, true, true, false),
  ('clinic_plus', 'Clinic+', 'monthly', 14999, 4000, 5, 25, 10, 30, true, true, false)
ON CONFLICT (plan_key) DO NOTHING;

-- Demo clinic
INSERT INTO clinics (id, name, primary_phone, address_line1, city, state, country, timezone, default_language_code, active, onboarding_status)
VALUES ('00000000-0000-0000-0000-000000000001', 'Sri Murugan Clinic', '+914400000001', 'Anna Nagar', 'Chennai', 'Tamil Nadu', 'India', 'Asia/Kolkata', 'ta_tanglish', true, 'ready_for_agent')
ON CONFLICT (id) DO NOTHING;

INSERT INTO clinic_subscriptions (clinic_id, subscription_plan_id, status, plan_snapshot_json)
SELECT
  '00000000-0000-0000-0000-000000000001',
  sp.id,
  'manual_free',
  jsonb_build_object('plan_key', sp.plan_key, 'name', sp.name)
FROM subscription_plans sp
WHERE sp.plan_key = 'pilot'
ON CONFLICT DO NOTHING;

INSERT INTO clinic_settings (clinic_id, agent_enabled, answering_mode, fallback_phone, overflow_after_rings, booking_mode, max_concurrent_calls, recording_retention_days, transcript_retention_days, notify_staff_on_pending_appointment, pending_appointment_notification_channel)
VALUES ('00000000-0000-0000-0000-000000000001', false, 'off', '+919840000000', 4, 'pending_confirmation', 3, 10, 30, true, 'whatsapp')
ON CONFLICT (clinic_id) DO NOTHING;

INSERT INTO clinic_languages (clinic_id, language_code, is_default, enabled)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'ta_tanglish', true, true),
  ('00000000-0000-0000-0000-000000000001', 'english', false, true)
ON CONFLICT (clinic_id, language_code) DO NOTHING;

INSERT INTO clinic_onboarding_checklist (clinic_id, clinic_details_done, admin_user_done, clinic_hours_done, doctors_done, services_done, doctor_service_mapping_done, doctor_schedules_done, booking_rules_done, knowledge_base_done, notification_setup_done, telephony_setup_done, test_conversation_done, ready_for_agent)
VALUES ('00000000-0000-0000-0000-000000000001', true, true, true, true, true, true, true, true, true, true, false, false, true)
ON CONFLICT (clinic_id) DO NOTHING;

INSERT INTO users (id, name, email, phone, platform_role, active)
VALUES
  ('00000000-0000-0000-0000-000000000101', 'Platform Admin', 'platform@vaidya.local', '+910000000001', 'platform_admin', true),
  ('00000000-0000-0000-0000-000000000102', 'Clinic Admin', 'admin@sri-murugan.local', '+919840012345', NULL, true),
  ('00000000-0000-0000-0000-000000000103', 'Dr. Priya Login', 'priya@sri-murugan.local', '+919840012346', NULL, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO clinic_users (clinic_id, user_id, role, doctor_id, active)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000102', 'clinic_admin', NULL, true)
ON CONFLICT (clinic_id, user_id) DO NOTHING;

INSERT INTO doctors (id, clinic_id, user_id, name, qualification, active)
VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000001', NULL, 'Dr. Murugan', 'MBBS', true),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000103', 'Dr. Priya', 'MBBS, DCH', true),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000001', NULL, 'Dr. Kumar', 'MS Ortho', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO clinic_users (clinic_id, user_id, role, doctor_id, active)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000103', 'doctor', '00000000-0000-0000-0000-000000000202', true)
ON CONFLICT (clinic_id, user_id) DO NOTHING;

INSERT INTO clinic_services (id, clinic_id, service_key, service_name, description, handles_json, does_not_handle_json, red_flags_json, routing_examples_json, active)
VALUES
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000001', 'general_consultation', 'General Consultation', 'Fever, cold, cough, headache, mild stomach pain, BP/diabetes follow-up.', '["fever","cold","cough","headache","mild stomach pain","vayiru vali"]', '["eye checkup","tooth pain","fracture emergency"]', '["chest pain","breathing difficulty","severe bleeding"]', '["Fever irukku","Vayiru vali irukku"]', true),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000001', 'paediatric_consultation', 'Paediatric Consultation', 'Child fever, child cold, vaccination consultation.', '["child fever","baby fever","vaccination"]', '["adult fever"]', '["child not breathing","fits"]', '["Kuzhandhaikku fever"]', true),
  ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000001', 'orthopaedic_consultation', 'Orthopaedic Consultation', 'Knee pain, back pain, joint pain.', '["knee pain","leg pain","back pain","joint pain"]', '["chest pain","eye checkup"]', '["major accident","severe bleeding"]', '["Knee pain irukku"]', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO doctor_services (id, clinic_id, doctor_id, clinic_service_id, consultation_fee_amount, followup_fee_amount, followup_valid_days, active)
VALUES
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000301', 500, 300, 7, true),
  ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000302', 700, 400, 7, true),
  ('00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000303', 1000, 600, 14, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO doctor_service_booking_rules (clinic_id, doctor_id, clinic_service_id, slot_duration_minutes, capacity_per_slot, booking_horizon_days, min_booking_notice_minutes, manual_edit_cutoff_before_start_minutes, manual_edit_max_shift_minutes, effective_from, active, version)
VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000301', 15, 3, 45, 30, 60, 60, CURRENT_DATE, true, 1),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000302', 15, 2, 45, 30, 60, 60, CURRENT_DATE, true, 1),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000303', 30, 1, 45, 30, 60, 60, CURRENT_DATE, true, 1)
ON CONFLICT DO NOTHING;

INSERT INTO clinic_hours (clinic_id, day_of_week, start_time, end_time, active)
SELECT '00000000-0000-0000-0000-000000000001', d, '09:00'::time, '13:00'::time, true
FROM generate_series(1,6) d
WHERE NOT EXISTS (
  SELECT 1 FROM clinic_hours ch
  WHERE ch.clinic_id = '00000000-0000-0000-0000-000000000001'
    AND ch.day_of_week = d
    AND ch.start_time = '09:00'::time
    AND ch.end_time = '13:00'::time
);

INSERT INTO clinic_hours (clinic_id, day_of_week, start_time, end_time, active)
SELECT '00000000-0000-0000-0000-000000000001', d, '17:00'::time, '21:00'::time, true
FROM generate_series(1,6) d
WHERE NOT EXISTS (
  SELECT 1 FROM clinic_hours ch
  WHERE ch.clinic_id = '00000000-0000-0000-0000-000000000001'
    AND ch.day_of_week = d
    AND ch.start_time = '17:00'::time
    AND ch.end_time = '21:00'::time
);

INSERT INTO doctor_schedules (clinic_id, doctor_id, doctor_service_id, day_of_week, start_time, end_time, active)
SELECT ds.clinic_id, ds.doctor_id, ds.id, d, '18:00'::time, '21:00'::time, true
FROM doctor_services ds, generate_series(1,6) d
WHERE ds.clinic_id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT DO NOTHING;

-- Minimal templates
INSERT INTO message_templates (template_key, language_code, template_text, required_variables_json)
VALUES
('booking.greeting','ta_tanglish','Vanakkam. {clinic_name} Vaidya pesuren. Enna problem-ku appointment venum?','["clinic_name"]'),
('booking.greeting','english','Hello. This is Vaidya from {clinic_name}. What problem do you need the appointment for?','["clinic_name"]'),
('booking.ask_problem_or_doctor','ta_tanglish','Endha doctor-a paakanum? Illena enna problem-ku appointment venum?','[]'),
('booking.ask_problem_or_doctor','english','Which doctor would you like to see, or what problem do you need help with?','[]'),
('booking.propose_slots','ta_tanglish','{doctor_name} {date_display} {slot_list} slots irukku. Edha choose panreenga?','["doctor_name","date_display","slot_list"]'),
('booking.confirm_doctor','ta_tanglish','{doctor_name}-a appointment book pannalama? {date_display} {slot_time}-ku slot ready.','["doctor_name","date_display","slot_time"]'),
('booking.slot_unavailable','ta_tanglish','Sorry, antha slot book aagiruchu. Vera slot choose pannunga: {slot_list}','["slot_list"]'),
('booking.thank_you','ta_tanglish','Seri, thanks.','[]'),
('booking.ask_reason','ta_tanglish','Enna problem-ku appointment venum?','[]'),
('booking.ask_alternate_time','ta_tanglish','Indha date/time-ku slots illa. Vera date or time sollunga.','[]'),
('booking.offer_help','ta_tanglish','Vera edhavadhu help venuma?','[]'),
('booking.ask_what_help','ta_tanglish','Ungaluku enna help venum?','[]'),
('booking.ask_time','ta_tanglish','{time_options} prefer panreenga?','["time_options"]'),
('booking.created_pending','ta_tanglish','Unga appointment request create panniten. Clinic staff confirm pannuvanga.','[]'),
('booking.created_confirmed','ta_tanglish','Unga appointment confirm aayiduchu.','[]'),
('knowledge.no_answer','ta_tanglish','Indha detail clinic staff confirm pannuvanga.','[]'),
('knowledge.no_answer','english','Clinic staff will confirm this.','[]'),
('fee.answer','ta_tanglish','{doctor_name} consultation fee {fee_amount} irukku.','["doctor_name","fee_amount"]'),
('fee.answer','english','{doctor_name} consultation fee is {fee_amount}.','["doctor_name","fee_amount"]'),
('fee.followup_answer','ta_tanglish','{doctor_name} follow-up fee {fee_amount} irukku.','["doctor_name","fee_amount"]'),
('fee.followup_answer','english','{doctor_name} follow-up fee is {fee_amount}.','["doctor_name","fee_amount"]'),
('fee.ask_doctor','ta_tanglish','Edha doctor fees venum?','[]'),
('fee.ask_doctor','english','Which doctor fee do you need?','[]'),
('timing.answer','ta_tanglish','Clinic timing {timing_text}.','["timing_text"]'),
('timing.answer','english','Clinic hours are {timing_text}.','["timing_text"]'),
('timing.day_answer','ta_tanglish','{day_name} clinic {timing_text}.','["day_name","timing_text"]'),
('timing.day_answer','english','On {day_name}, clinic hours are {timing_text}.','["day_name","timing_text"]'),
('timing.day_closed','ta_tanglish','{day_name} clinic closed.','["day_name"]'),
('timing.day_closed','english','The clinic is closed on {day_name}.','["day_name"]'),
('location.answer','ta_tanglish','Clinic address: {clinic_address}.','["clinic_address"]'),
('location.answer','english','Clinic address: {clinic_address}.','["clinic_address"]'),
('availability.today_slots','ta_tanglish','{doctor_name} {date_label} {slot_list} slots irukku.','["doctor_name","date_label","slot_list"]'),
('availability.today_slots','english','{doctor_name} has these slots on {date_label}: {slot_list}.','["doctor_name","date_label","slot_list"]'),
('availability.no_slots','ta_tanglish','Indha date-ku slots illa.','[]'),
('availability.no_slots','english','No slots are available for that date.','[]'),
('availability.not_available','ta_tanglish','{doctor_name} indha date-ku available illa.','["doctor_name"]'),
('availability.not_available','english','{doctor_name} is not available on that date.','["doctor_name"]'),
('knowledge.answer','ta_tanglish','{answer_text}','["answer_text"]'),
('knowledge.answer','english','{answer_text}','["answer_text"]'),
('cancel.confirm','ta_tanglish','Appointment cancel panna confirm pannureengala?','[]'),
('cancel.confirm','english','Do you want to cancel this appointment?','[]'),
('cancel.not_cancelled','ta_tanglish','Appointment cancel pannala.','[]'),
('cancel.not_cancelled','english','The appointment was not cancelled.','[]'),
('cancel.no_appointment_found','ta_tanglish','Matching appointment kidaikkala.','[]'),
('cancel.no_appointment_found','english','No matching appointment was found.','[]'),
('cancel.select_appointment','ta_tanglish','Unga upcoming appointments: {appointment_list}. Edha cancel pannanum?','["appointment_list"]'),
('cancel.select_appointment','english','Your upcoming appointments: {appointment_list}. Which one should I cancel?','["appointment_list"]'),
('cancel.request_submitted','ta_tanglish','Cancel request create panniten. Clinic staff confirm pannuvanga.','[]'),
('cancel.request_submitted','english','Your cancel request has been submitted. Clinic staff will confirm.','[]'),
('reschedule.ask_new_date','ta_tanglish','New date enna venum?','[]'),
('reschedule.ask_new_date','english','Which new date would you like?','[]'),
('reschedule.ask_new_time','ta_tanglish','New time preference enna?','[]'),
('reschedule.ask_new_time','english','What time would you prefer?','[]'),
('reschedule.propose_slots','ta_tanglish','Indha slots available: {slot_list}.','["slot_list"]'),
('reschedule.propose_slots','english','These slots are available: {slot_list}.','["slot_list"]'),
('reschedule.confirm','ta_tanglish','Reschedule details correct-a?','[]'),
('reschedule.confirm','english','Please confirm the reschedule details.','[]'),
('reschedule.not_changed','ta_tanglish','Appointment change pannala.','[]'),
('reschedule.not_changed','english','The appointment was not changed.','[]'),
('reschedule.request_submitted','ta_tanglish','Reschedule request create panniten. Clinic staff confirm pannuvanga.','[]'),
('reschedule.request_submitted','english','Your reschedule request has been submitted. Clinic staff will confirm.','[]'),
('handoff.ask_reason','ta_tanglish','Clinic staff-kitta pesanum-na reason sollunga.','[]'),
('handoff.ask_reason','english','Please tell me why you want to speak with clinic staff.','[]'),
('handoff.ask_name','ta_tanglish','Unga name sollunga.','[]'),
('handoff.ask_name','english','Please share your name.','[]'),
('handoff.ask_phone','ta_tanglish','Callback number sollunga.','[]'),
('handoff.ask_phone','english','Please share a callback number.','[]'),
('handoff.created','ta_tanglish','Clinic staff unga callback request receive pannuvanga.','[]'),
('handoff.created','english','Clinic staff will receive your callback request.','[]'),
('handoff.cancelled','ta_tanglish','Handoff request cancel panniten.','[]'),
('handoff.cancelled','english','The handoff request was cancelled.','[]'),
('safety.emergency','ta_tanglish','Idhu emergency-a irukkalaam. Please immediate-a 108-ku call pannunga illa nearest hospital-ku ponga.','[]'),
('safety.medical_advice_refusal','ta_tanglish','Naan medical advice kudukka mudiyadhu. Doctor consult panna appointment book panna help panren.','[]')
ON CONFLICT (template_key, language_code) DO NOTHING;

INSERT INTO clinic_knowledge_base (clinic_id, question, answer, category, alternative_phrases_json, status, search_text, approved_by_user_id, approved_at)
VALUES
('00000000-0000-0000-0000-000000000001','Parking irukka?','Two-wheeler parking is available near the clinic. Car parking depends on street availability.','facility_info','["parking available","parking irukka"]','approved','parking irukka two-wheeler car parking', '00000000-0000-0000-0000-000000000102', now()),
('00000000-0000-0000-0000-000000000001','First visit-ku enna kondu varanum?','Please bring previous reports, current medicines, and any doctor notes if available.','pre_visit_instruction','["first visit documents","enna kondu varanum"]','approved','first visit documents reports medicines', '00000000-0000-0000-0000-000000000102', now()),
('00000000-0000-0000-0000-000000000001','Scan-ku fasting venuma?','Abdomen scan may require fasting. Other scans depend on scan type. Clinic staff will confirm.','pre_visit_instruction','["scan fasting","scan-ku sapdalaama","ultrasound fasting","xray fasting","CT scan fasting"]','approved','scan-ku fasting venuma abdomen scan sapdalaama ultrasound xray ct scan', '00000000-0000-0000-0000-000000000102', now())
ON CONFLICT DO NOTHING;

COMMIT;
