# Vaidya Milestone Testing Pack

Use this pack after each Vaidya milestone. Do not move to the next milestone until the relevant file passes.

## Test order

1. Run common checks first.
2. Run the milestone-specific Agent or Application checks.
3. Run the regression checklist.
4. Commit only after all required checks pass.

## Standard commands

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

API local:

```bash
pnpm --filter api dev
curl http://localhost:3000/health
```

Web local:

```bash
pnpm --filter web dev
```

Database:

```bash
pnpm --filter api db:migrate
pnpm --filter api db:seed
```

## Required env before testing

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vaidya_local
JWT_SECRET=dev_only_change_me_very_long_secret_for_local_development
AUTH_MODE=dev
QUEUE_MODE=inline
PRIMARY_LLM_PROVIDER=mock
STT_PROVIDER=mock
TTS_PROVIDER=mock
TELEPHONY_PROVIDER=mock
MESSAGING_PROVIDER=mock
```

## Test result format

For every milestone, record:

```text
Milestone:
Date:
Developer:
Commit hash:
Passed:
Failed:
Known issues:
Ready for next milestone: yes/no
```
