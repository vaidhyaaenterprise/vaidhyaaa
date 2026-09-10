# A04 Structured Info and Knowledge - What to Test and How

## Goal
Verify fee, timing, location, doctor availability, approved knowledge answers, tenant isolation, and side-question resume behavior.

## Structured info tests

Send messages:

```text
Dr Priya fees evlo?
Dr Murugan follow-up fee evlo?
Fees evlo? then Dr. Murugan
Clinic timing enna?
Sunday open-a?
Clinic enga irukku?
Dr Priya inniku irukkangala?
```

Expected:

```text
[ ] Doctor-specific fee comes from structured fee table
[ ] Follow-up fee only returns follow-up fee, not both fees unless asked
[ ] Fee without doctor enters fee clarification flow
[ ] Sunday open-a returns Sunday-only answer
[ ] Today availability answers today only
[ ] Location comes from structured clinic/address data
[ ] No appointment is created for structured questions
```

## Missing fee/procedure test

Message:

```text
MRI scan fee evlo?
```

Expected:

```text
[ ] Does not ask which doctor
[ ] Does not hallucinate fee
[ ] Replies clinic staff will confirm
```

## Knowledge tests

Messages:

```text
Scan-ku fasting venuma?
Scan-ku sapdalaama?
Parking irukka?
First visit-ku enna kondu varanum?
Insurance accept pannuveengala?
Report ready-a?
Tooth extraction-ku fasting venuma?
```

Expected:

```text
[ ] Approved answer used when exists for same clinic
[ ] Alternative wording finds same approved answer
[ ] pending_review answer is not used
[ ] Another clinic's dental answer is not used
[ ] Unknown FAQ falls back to clinic staff will confirm
[ ] Medical advice is not answered from knowledge
[ ] Emergency is not answered from knowledge
```

## Structured DB vs Knowledge precedence

If both a KB row and structured fee/hour exist:

```text
[ ] doctor fee answer uses structured DB
[ ] clinic hours answer uses structured DB
[ ] doctor availability uses schedules/slots
[ ] KB cannot override updated structured settings
```

## Side-question inside booking

Start booking:

```text
Naalaikku evening appointment venum
Parking irukka?
```

Expected:

```text
[ ] Answers parking if approved
[ ] Keeps current_flow=booking
[ ] Resumes ASK_PROBLEM_OR_DOCTOR prompt
```

Inside ASK_DATE:

```text
Scan-ku fasting venuma?
```

Expected:

```text
[ ] Answers knowledge
[ ] Resumes date prompt
[ ] current_state remains ASK_DATE
```

## Pass condition

A04 passes when structured facts and approved knowledge are clearly separated, tenant isolation is enforced, and active flows are not broken by side questions.
