# C00 Project Bootstrap - What to Test and How

## Goal
Verify that the repo foundation is production-standard and ready for both Agent and Application development.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Verify repo structure

```text
[ ] apps/api exists
[ ] apps/web exists
[ ] packages/shared exists
[ ] packages/config exists if used
[ ] pnpm-workspace.yaml exists
[ ] root package.json has workspace scripts
[ ] README.md has local setup instructions
[ ] .env.example exists at root
[ ] apps/api/.env.example exists
[ ] apps/web/.env.example exists
[ ] no real .env files are committed
[ ] docs/, prompts/, sql/, tests/ folders exist
```

## Verify API bootstrap

```bash
pnpm --filter api dev
curl http://localhost:3000/health
```

Expected:

```text
[ ] API starts without TypeScript/runtime errors
[ ] /health returns success JSON
[ ] request_id is generated/logged
[ ] invalid route returns standard error format
```

## Verify web bootstrap

```bash
pnpm --filter web dev
```

Expected:

```text
[ ] Web app opens
[ ] Environment variable NEXT_PUBLIC_API_BASE_URL is used
[ ] No direct DB access from frontend
[ ] Basic shell does not hardcode production URLs
```

## Must not be implemented in C00

```text
[ ] No booking business logic
[ ] No real LLM provider usage
[ ] No voice/STT/TTS integration
[ ] No WhatsApp/SMS integration
[ ] No manual appointment implementation
[ ] No overbuilt dashboard screens
```

## Pass condition

C00 passes when both apps start, shared package builds, root commands pass, and the project structure matches the agreed monorepo layout.
