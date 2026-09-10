# Application Milestone P00 - Next.js App Shell, Navigation, RBAC UI Foundation

## Goal
Build the admin/doctor portal shell with five tabs and role-aware visibility. Do not implement all business screens yet.

## Final app tabs
1. Home
2. Call inbox
3. Appointments
4. Clinic setup
5. Knowledge base

## Role rules
- Admin sees all tabs.
- Doctor does not see Call inbox.
- Doctor sees own appointments only.
- Doctor sees own timing/service setup only.
- Doctor cannot see Knowledge base initially.
- Doctor cannot toggle agent.

## Required UI pieces
- App layout with sidebar/topbar.
- Clinic switcher placeholder.
- Role-aware nav.
- Shared API client.
- Standard error display.
- Loading/empty/error states.
- Dev-auth switcher for local: platform_admin, clinic_admin, doctor.

## Do not implement yet
- Full login OTP UI
- Voice features
- Billing UI

## Tests
1. Admin nav shows all five tabs.
2. Doctor nav hides Call inbox and Knowledge base.
3. Doctor cannot navigate to admin-only route by URL.
4. API errors render standard error message.
5. Loading and empty states render.
6. Dev-auth switcher changes visible role.

## Acceptance criteria
- App shell is clean and role-aware.
- All future screens use shared layout and API client.
