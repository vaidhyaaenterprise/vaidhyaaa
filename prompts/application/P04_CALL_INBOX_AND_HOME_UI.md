# Application Milestone P04 - Call Inbox and Home Dashboard

## Goal
Build admin-only Call Inbox and operational Home dashboard.

## Call Inbox - admin only
Sections:
1. Call list
2. Call detail preview
3. Recording + transcript

## Call list columns
- call time
- caller phone
- patient name if known
- duration
- summary
- outcome
- action needed
- linked appointment/callback/emergency

## Filters
- date range
- outcome
- emergency only
- callback only
- appointment request only
- action needed

## Recording/transcript rules
- MP3/audio signed URL available for 10 days.
- Transcript text available for 30 days.
- Access to recording/transcript writes audit log.
- Doctor cannot access Call Inbox.

## Home dashboard
Lowest priority but useful:
- calls today
- pending confirmations
- callbacks
- emergency alerts
- knowledge gaps
- agent status
- next appointments

## Tests
1. Admin can view call inbox.
2. Doctor cannot view call inbox by nav or URL.
3. Call detail shows summary/outcome/action.
4. Recording URL request returns signed URL only if not expired.
5. Expired recording shows unavailable state.
6. Transcript older than 30 days shows unavailable state.
7. Recording access writes audit log.
8. Home shows pending confirmations and callbacks.
9. Agent status reflects clinic_settings.
10. Emergency alert appears on Home.

## Acceptance criteria
- Admin can review calls safely.
- Retention rules are reflected in UI.
