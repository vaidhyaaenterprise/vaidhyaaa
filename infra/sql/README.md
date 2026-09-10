# SQL migrations

Production schema baseline:

- `001_initial_schema_production.sql` — full PostgreSQL schema
- `002_c04_schema_alignment.sql` — C04 incremental alignment (indexes, background_jobs)
- `002_seed_minimal_qa.sql` — minimal QA seed data

Apply migrations in order via `pnpm db:migrate` or the `@vaidya/db` CLI.
