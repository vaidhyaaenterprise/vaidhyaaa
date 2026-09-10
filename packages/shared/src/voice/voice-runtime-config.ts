/** Voice runtime defaults — used by adapters and QA; not a live telephony implementation. */
export const VOICE_RUNTIME_DEFAULTS = {
  silence_timeout_seconds: 5,
  no_speech_retry_count: 2,
  max_call_duration_seconds: 300,
  stt_low_confidence_threshold: 0.55,
  llm_timeout_ms: 5000,
  tts_timeout_ms: 8000,
  recording_retention_days: 10,
  transcript_retention_days: 30,
} as const;

export type VoiceRuntimeConfig = typeof VOICE_RUNTIME_DEFAULTS;
