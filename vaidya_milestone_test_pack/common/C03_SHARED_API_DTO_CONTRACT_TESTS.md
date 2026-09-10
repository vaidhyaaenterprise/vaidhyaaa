# C03 Shared API DTO Contract - What to Test and How

## Goal
Verify shared contracts are ready so Agent and Application developers do not invent different field names.

## Build checks

```bash
pnpm --filter shared build
pnpm typecheck
pnpm test
```

## Shared exports must include

```text
[ ] role enums/constants
[ ] appointment status constants
[ ] slot status constants
[ ] slot hold status constants
[ ] booking mode constants
[ ] agent answering mode constants
[ ] language code constants
[ ] notification event type constants
[ ] standard API error schema
[ ] pagination schema
[ ] appointment DTOs
[ ] clinic setup DTOs
[ ] knowledge DTOs
[ ] conversation DTOs
```

## Contract usage check

```text
[ ] apps/api imports schemas/constants from packages/shared
[ ] apps/web imports schemas/constants from packages/shared
[ ] No duplicated enum strings in API and web
[ ] Zod schemas validate request bodies in API
[ ] API responses match shared response schemas
```

## Error format check

Send invalid body to any endpoint:

```bash
curl -X POST http://localhost:3000/v1/doctors -H 'content-type: application/json' -d '{}'
```

Expected shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "...",
    "details": {},
    "request_id": "..."
  }
}
```

## Pass condition

C03 passes when API and Web share DTOs/constants from one package and standard error handling works consistently.
