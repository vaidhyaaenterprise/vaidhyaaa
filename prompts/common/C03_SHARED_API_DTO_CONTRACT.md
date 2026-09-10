# Common Milestone C03 - Shared API DTO and Contract Foundation

## Goal
Create shared Zod schemas and API client conventions so Agent and Application developers do not invent different field names.

## Required shared packages
- `packages/shared/src/dto`
- `packages/shared/src/errors`
- `packages/shared/src/enums`
- `packages/shared/src/templates`
- `packages/shared/src/api-client`

## Required shared enums/constants
- user roles
- appointment statuses
- slot statuses
- slot hold statuses
- appointment action request statuses
- conversation flows/states
- notification event types
- supported language codes
- API error codes

## Required DTO groups
- auth DTOs
- clinic settings DTOs
- doctor DTOs
- doctor schedule DTOs
- doctor-service mapping DTOs
- doctor-service booking rule DTOs
- clinic hours and holidays DTOs
- appointment DTOs
- appointment action request DTOs
- conversation message DTOs
- knowledge DTOs
- call inbox DTOs
- notification DTOs

## API method policy to encode
- POST creates resources/actions.
- PUT replaces full resource/collection.
- PATCH partially updates fields.
- `clinic_settings` has GET/PATCH, optional PUT, no normal POST.
- doctor schedules and clinic hours support GET + PUT full replacement + POST add window + PATCH edit window + disable action.

## Tests
1. DTO schemas reject missing required fields.
2. Appointment creation DTO requires `reason_for_visit`.
3. Booking rule DTO requires `slot_duration_minutes` and `capacity_per_slot`.
4. Clinic setting patch accepts partial update.
5. Clinic setting put requires full object if implemented.
6. Error DTO matches standard error shape.
7. Shared enums are imported by both API and web without circular dependency.

## Acceptance criteria
- Backend and frontend use shared DTOs.
- API fields are stable.
- Each developer can work independently without field-name drift.
