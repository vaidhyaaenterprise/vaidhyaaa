BEGIN;

ALTER TABLE clinic_telephony_settings
  DROP CONSTRAINT IF EXISTS clinic_telephony_settings_provider_check;

ALTER TABLE clinic_telephony_settings
  ADD CONSTRAINT clinic_telephony_settings_provider_check
  CHECK (provider IN ('exotel', 'twilio', 'other', 'mock'));

COMMIT;
