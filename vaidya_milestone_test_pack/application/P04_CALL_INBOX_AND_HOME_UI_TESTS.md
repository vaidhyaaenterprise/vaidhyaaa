# P04 Call Inbox and Home UI - What to Test and How

## Goal
Verify admin-only call inbox, recording/transcript display, retention messaging, call outcome preview, and Home action summary.

## Call inbox visibility

```text
[ ] Admin can see Call inbox
[ ] Doctor cannot see Call inbox
[ ] Direct doctor access to call inbox URL returns forbidden/redirect
```

## Call list

Columns/fields:

```text
[ ] call time
[ ] caller phone
[ ] patient name if known
[ ] duration
[ ] outcome
[ ] summary
[ ] action needed
[ ] appointment/callback/emergency link if any
```

Filters:

```text
[ ] date range
[ ] outcome
[ ] emergency only
[ ] callback only
[ ] appointment request only
[ ] action needed
```

## Call detail preview

```text
[ ] patient info
[ ] summary
[ ] outcome
[ ] linked appointment/callback/emergency
[ ] intent/source
[ ] staff action required
```

## Recording and transcript

```text
[ ] Audio player shown only if recording exists and not expired
[ ] UI says audio retained 10 days
[ ] Transcript shown only if not expired
[ ] UI says transcript retained 30 days
[ ] Signed URL is requested from backend, not stored in frontend permanently
[ ] Accessing recording creates audit/access log if implemented
```

## Home dashboard

```text
[ ] Shows pending appointment confirmations
[ ] Shows callback requests
[ ] Shows emergency alerts
[ ] Shows agent status
[ ] Shows today call summary
[ ] Doctor home shows own upcoming appointments only
[ ] No routing quality/model score/AI debug visible to clinic users
```

## Pass condition

P04 passes when call inbox is admin-only, retention rules are visible and enforced, and Home shows operational action items without internal AI metrics.
