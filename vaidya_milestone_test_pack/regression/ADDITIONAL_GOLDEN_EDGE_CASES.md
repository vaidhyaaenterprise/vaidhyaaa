# Additional Golden Edge Cases

Run these after every new addendum milestone.

## Slot and capacity

1. Capacity 1, two patients select same slot concurrently -> one hold succeeds, one fails.
2. Capacity 3, four patients select same slot concurrently -> three holds succeed, one fails.
3. Proposed slot becomes full before user chooses -> user gets alternative slots.
4. Hold expires -> slot becomes available in availability query.
5. Patient confirms after hold expired and slot still available -> booking succeeds after recheck.
6. Patient confirms after hold expired and slot full -> booking fails safely and asks another slot.
7. Admin cancels confirmed appointment -> capacity is released.
8. Pending appointment cancelled -> capacity is released.

## Slot rule changes

9. Capacity increase no conflict -> future open slots update capacity.
10. Capacity decrease no conflict -> future open slots update capacity.
11. Capacity decrease with occupancy conflict -> change blocked, no auto-cancel.
12. Duration increase no conflict -> old open slots superseded, new slots generated.
13. Duration increase with conflicts -> change blocked, conflict list returned.
14. Schedule/holiday change with future appointments -> blocked/conflict list, no auto-cancel.

## Manual edit

15. Doctor quick edits own appointment within 60 minutes shift and before cutoff -> allowed if capacity exists.
16. Doctor edits other doctor's appointment -> forbidden.
17. Doctor quick edit inside cutoff before start -> blocked.
18. Admin quick edit outside clinic hours with override reason -> allowed if no double booking.
19. More than 1-hour time change -> cancel/rebook/formal reschedule, not silent update.

## Identity and RBAC

20. Doctor profile exists without user login -> admin can schedule/book for doctor.
21. Doctor later invited -> same doctor_id linked to new user through clinic_users.
22. Inactive clinic_user -> cannot access clinic.
23. doctors.active=false -> not routed by agent and no new slots generated.
24. Doctor cannot view call inbox.

## Agent and LLM

25. Mock remains default in local/CI.
26. Real Sarvam only used when provider env is sarvam.
27. LLM invalid JSON -> retry/fallback, no crash.
28. LLM never writes DB.
29. Active state answers like 6:30/Kumar/Seri/vendam are parsed by code, not LLM.
30. Emergency overrides booking/cancel/reschedule/handoff.

## Notifications and jobs

31. Pending appointment -> no patient confirmation notification.
32. Confirmed appointment -> patient notification event created.
33. Provider failure -> retry then sent/failed status.
34. Emergency -> patient gets immediate 108 response and clinic alert is queued.
35. Recording older than 10 days -> deleted from object storage.
36. Transcript older than 30 days -> deleted/anonymized.

## Knowledge and language

37. Fees/timing/availability/location answered from structured DB, not KB.
38. Parking/scan prep/insurance answered only from approved KB.
39. Pending KB answer never used.
40. English please switches session to english.
41. Template missing in enabled language -> fallback and log missing template.
