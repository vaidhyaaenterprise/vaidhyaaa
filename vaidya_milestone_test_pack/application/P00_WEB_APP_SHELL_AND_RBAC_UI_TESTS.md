# P00 Web App Shell and RBAC UI - What to Test and How

## Goal
Verify Next.js app shell, layout, role-aware navigation, dev auth integration, and basic API connectivity.

## Commands

```bash
pnpm --filter web dev
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test
```

## App shell checks

```text
[ ] App opens at local URL
[ ] Main layout renders
[ ] Sidebar/top nav exists
[ ] Five tabs are present: Home, Call inbox, Appointments, Clinic setup, Knowledge base
[ ] API base URL comes from NEXT_PUBLIC_API_BASE_URL
[ ] Loading, error, and empty states exist in shared components
[ ] No direct DB access from web
```

## Role navigation checks

Login as clinic_admin/dev admin:

```text
[ ] Home visible
[ ] Call inbox visible
[ ] Appointments visible
[ ] Clinic setup visible
[ ] Knowledge base visible
```

Login as doctor/dev doctor:

```text
[ ] Home visible with limited own data
[ ] Appointments visible for own records
[ ] Clinic setup visible only for own schedule/services if enabled
[ ] Call inbox hidden
[ ] Knowledge base hidden
[ ] Agent toggle hidden
```

## Auth state checks

```text
[ ] Unauthenticated user redirected to login/dev login
[ ] /v1/me is called once on app load or through query cache
[ ] Inactive user gets blocked UI message
[ ] Token/session errors show clear message
```

## Pass condition

P00 passes when the app shell is role-aware and can safely connect to API without implementing detailed screens yet.
