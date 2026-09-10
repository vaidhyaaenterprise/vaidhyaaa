# P05 Notifications and Settings UI - What to Test and How

## Goal
Verify notification settings, staff pending notifications, agent modes, language settings, subscription/plan display, and safe settings behavior.

## Agent settings

```text
[ ] Admin can turn agent_enabled on/off
[ ] Agent cannot be enabled if onboarding incomplete
[ ] answering_mode options displayed: off, always_on, after_hours_only, overflow_after_n_rings, holiday_only
[ ] fallback_phone is required before enabling voice agent
[ ] toggling agent writes audit log
[ ] Doctor cannot change agent settings
```

## Staff notification settings

```text
[ ] Admin can enable notify_staff_on_pending_appointment
[ ] Admin can select pending notification channel
[ ] UI explains patient is notified only after appointment confirmation
[ ] Test notification button uses mock/provider-safe endpoint
```

## Notification event visibility

```text
[ ] Admin can see notification_events list/status if included
[ ] Failed notification shows retry/failure state
[ ] Duplicate notifications are not sent for same dedupe key
```

## Language settings

```text
[ ] Admin can view enabled languages
[ ] Default language is ta_tanglish
[ ] English can be enabled
[ ] Future languages can be added through supported_languages/clinic_languages design
[ ] Missing templates are surfaced in setup/review, not ignored
```

## Subscription/plan display

Least priority, but verify if implemented:

```text
[ ] Admin can see current plan
[ ] max_concurrent_calls is limited by plan
[ ] recording/transcript retention limits shown
[ ] usage month summary shown if available
[ ] Plan data is read-only unless platform admin
```

## Error states

```text
[ ] Provider failure shown clearly
[ ] Invalid setting update shows standard API error
[ ] Insufficient plan limit shows clear message
[ ] Doctor sees forbidden state rather than broken UI
```

## Pass condition

P05 passes when settings are safe, role-aware, plan-aware, and notification behavior matches production rules.
