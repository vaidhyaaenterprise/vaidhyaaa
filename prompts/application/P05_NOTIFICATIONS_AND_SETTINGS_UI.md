# Application Milestone P05 - Notifications, Agent Toggle, Plan/Language Settings

## Goal
Build UI around notification settings, agent toggle, language settings, and low-priority subscription display.

## Agent toggle
- Admin only.
- Stored in clinic_settings.agent_enabled.
- If enabled, backend validates onboarding readiness.
- If disabled, voice calls forward to fallback_phone.

## Notification settings
- notify_staff_on_pending_appointment
- pending appointment notification channel
- notification contacts later if needed

## Language settings
- supported languages visible
- clinic languages selectable
- default language: ta_tanglish
- english enabled from day one
- adding language should rely on templates/language pack, not state machine rewrite

## Subscription display - least priority
- show current plan and limits if data exists
- no full billing/payment UI yet
- show max_concurrent_calls limit
- show included voice minutes later

## Tests
1. Admin can toggle agent only when onboarding is ready.
2. Agent enable blocked if setup incomplete.
3. Doctor cannot toggle agent.
4. Fallback phone is required before enabling voice mode.
5. Staff pending notification setting saves.
6. Clinic default language can be changed to English.
7. Template missing warning appears if language lacks templates.
8. Plan limits display without payment integration.
9. Setting max_concurrent_calls above plan limit is rejected by backend and shown in UI.

## Acceptance criteria
- Operational settings are admin-only and safe.
