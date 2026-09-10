# A11B - Sarvam Provider Smoke and Auth Hardening

## Purpose

Verify real Sarvam calls work before blaming model quality.

## Implement

1. Add `pnpm --filter api agent:sarvam:smoke` command.
2. Test both auth modes if configured: subscription key and bearer.
3. Extract assistant content robustly.
4. Handle null/empty content clearly.
5. Parse JSON robustly.
6. Retry once with minimal payload if optional fast params fail.
7. Do not log full sensitive payloads in production mode.

## Env

```env
SARVAM_API_KEY=
SARVAM_AUTH_MODE=subscription # subscription | bearer | auto
PRIMARY_LLM_MODEL=sarvam-30b
FALLBACK_LLM_MODEL=sarvam-105b
```

## Smoke messages

- `Naalaikku evening appointment venum`
- `Fever-ku enna tablet?`
- `Chest pain irukku`
- `Sunday open-a?`

## Acceptance

- If key missing, command exits with clear skip message.
- If key present, command returns JSON classifications.
- Invalid JSON/empty content does not crash API.
