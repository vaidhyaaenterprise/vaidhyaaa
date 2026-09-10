# P07 - Subscription and Language Settings UI

## Purpose

Expose subscription and language settings safely. Billing/payment remains low priority. This milestone is mostly read-only or platform/admin controlled.

## Subscription UI

### Admin clinic view

In Clinic Setup or Settings, show:

- current plan name
- status: trialing, active, manual_free, expired, etc.
- included minutes
- used minutes this month
- max concurrent calls
- recording retention days
- transcript retention days
- overage if available

Clinic admin should not directly change plan in v1 unless backend supports it.

### Platform admin view

Platform admin can assign/change plan manually:

- plan_key
- status
- trial_end
- notes

## Language UI

Clinic admin should see:

- default language
- enabled languages
- ta_tanglish enabled
- english enabled

For v1:

- ta_tanglish and english available.
- Adding a new platform language may be platform_admin only.

## Template coverage display

Optional internal/platform view:

- template_key
- ta_tanglish exists yes/no
- english exists yes/no
- missing templates highlighted

## APIs expected

```http
GET /v1/clinic/subscription
GET /v1/clinic/usage/current-month
GET /v1/languages
GET /v1/clinic/languages
PUT /v1/clinic/languages
```

Platform:

```http
GET /internal/platform/subscription-plans
POST /internal/platform/clinics/:clinicId/subscription/change
```

## Tests

1. Clinic admin can view subscription summary.
2. Doctor cannot edit subscription.
3. Clinic admin can view enabled languages.
4. Clinic admin can set default language if allowed.
5. Backend rejects unsupported language.
6. Template missing state is visible in internal view if implemented.
7. Plan limits are displayed but not bypassable from frontend.

## Acceptance criteria

- Subscription readiness is visible.
- Language extensibility settings are visible.
- No payment/billing complexity is introduced in v1.
