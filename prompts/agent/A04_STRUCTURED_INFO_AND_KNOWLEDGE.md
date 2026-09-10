# Agent Milestone A04 - Structured Info Handlers and Knowledge Base Runtime

## Goal
Implement safe answering for fee, timing, location, doctor availability, and approved knowledge Q&A.

## Structured DB wins
Use structured tables for:
- doctor fees -> doctor_services
- clinic timing -> clinic_hours
- doctor availability -> doctor_schedules + appointment_slots
- holidays -> clinic_holidays
- location -> clinics
- services -> clinic_services + doctor_services

Use knowledge base only for:
- parking
- first visit documents
- scan/test preparation
- insurance/cashless explanation
- report collection process
- clinic-approved FAQs

## Required components
- StructuredInfoHandler
- FeeHandler
- TimingHandler
- LocationHandler
- DoctorAvailabilityHandler
- KnowledgeRuntimeHandler
- KnowledgeSearchService simple text search first

## Behavior
- Do not hallucinate missing fees, timings, availability, or knowledge.
- Only `clinic_knowledge_base.status=approved` can be used.
- Pending/disabled/needs_update knowledge is ignored.
- If no approved answer, reply clinic staff will confirm.
- Tenant isolation is mandatory.
- During active booking flow, answer side-question and resume booking prompt.

## Fee edge cases
- `Fees evlo?` with multiple doctors -> ask which doctor and enter fee_clarification.
- Follow-up fee question returns only follow-up fee, not consultation fee too.
- MRI/scan/procedure fee not in structured data -> staff confirmation fallback, not ask which doctor.
- Fee question during booking: answer consultation fee and ask if doctor should be selected.

## Timing edge cases
- `Sunday open-a?` answers only Sunday.
- `Inniku open-a?` answers today only.
- General timing question returns full schedule.

## Availability edge cases
- `Dr Priya inniku irukkangala?` answers today only, using available slots first.
- Do not start booking automatically for availability question.

## Tests
1. Doctor-specific fee works.
2. Fee clarification flow works: Fees evlo? -> Dr Murugan.
3. Follow-up fee returns only follow-up fee.
4. MRI scan fee returns staff confirmation.
5. Sunday open returns Sunday-only answer.
6. Today timing returns today-only answer.
7. Doctor availability today returns slots/no slots/not scheduled.
8. Location comes from clinics table.
9. Approved scan fasting answer works.
10. Pending knowledge is not used.
11. Other clinic knowledge is not used.
12. Knowledge side-question during booking resumes booking state.
13. Medical advice does not use knowledge.
14. Emergency does not use knowledge.

## Acceptance criteria
- Structured and knowledge answers are safe, clinic-scoped, and non-hallucinated.
