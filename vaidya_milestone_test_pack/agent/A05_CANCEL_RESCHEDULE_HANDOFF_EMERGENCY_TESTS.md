# A05 Cancel, Reschedule, Handoff, and Emergency - What to Test and How

## Goal
Verify cancel/reschedule action-request policy, handoff/callback flow, emergency override, medical advice refusal, and negative phrase handling.

## Cancel request by patient call

Messages:

```text
Appointment cancel pannunga
Seri
```

Expected default production behavior:

```text
[ ] Finds upcoming appointment
[ ] Asks confirmation
[ ] Creates appointment_action_request type=cancel status=pending
[ ] Does not directly cancel appointment unless clinic setting allows auto patient cancel
[ ] Admin notification event created
[ ] Appears in Appointments -> Reschedule / cancel
```

Negative confirmation:

```text
Appointment cancel pannunga
vendam
```

Expected:

```text
[ ] No action request created
[ ] Appointment unchanged
[ ] Flow stops safely
```

## Reschedule request by patient call

Messages:

```text
Appointment time change panna venum
May 16 2026
evening
6:30
Seri
```

Expected:

```text
[ ] Finds appointment
[ ] Collects new date/time/slot preference
[ ] Holds new slot temporarily if needed
[ ] Creates appointment_action_request type=reschedule status=pending
[ ] Does not directly modify appointment by default
[ ] Admin notification event created
```

## Handoff/callback flow

Messages:

```text
Receptionist kitta pesanum
Report pathi kekkanum
Kumar
```

Expected:

```text
[ ] Collects reason
[ ] Asks name if missing
[ ] Uses session phone if present
[ ] Creates callback_request status=pending
[ ] Creates staff notification event
```

Cancellation:

```text
Receptionist kitta pesanum
vendam
```

Expected:

```text
[ ] No callback request created
[ ] Flow cancelled safely
```

## Emergency override

During booking, cancel, reschedule, or handoff, send:

```text
Chest pain irukku
```

Expected:

```text
[ ] Emergency fixed 108 response
[ ] emergency_incident created
[ ] emergency alert notification_event created
[ ] No appointment/cancel/reschedule/callback action executed accidentally
```

## Medical advice override

Message:

```text
Fever-ku enna tablet edukkanum?
```

Expected:

```text
[ ] Fixed medical advice refusal
[ ] No knowledge answer
[ ] No diagnosis/dosage/treatment
```

## Negative phrases in active flows

Test:

```text
vendam
venam
venda
no
no thanks
stop
later
```

Expected:

```text
[ ] Active booking/handoff/reschedule flow stops safely
[ ] Any active slot_hold is released
[ ] No DB action accidentally created
```

## Pass condition

A05 passes when cancel/reschedule/handoff produce safe admin-reviewable actions, and emergency/medical-advice behavior overrides every active flow.
