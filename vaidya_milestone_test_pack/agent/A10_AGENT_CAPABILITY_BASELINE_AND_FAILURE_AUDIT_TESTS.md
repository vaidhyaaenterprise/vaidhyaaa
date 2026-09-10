# A10 Tests - Capability Baseline and Failure Audit

1. Run `pnpm --filter api agent:evaluate:mock`.
2. Evaluation prints total, pass, fail, category-wise accuracy.
3. booking category contains at least 20 examples.
4. active-state short replies category contains vendam/seri/inaiku/nalaki/6:30/name variants.
5. Unknown message stores reviewable failure/audit event.
6. Low-confidence classifier output stores reviewable failure/audit event.
7. DEBUG_API=true includes trace fields.
8. DEBUG_API=false hides trace from patient response.
9. No API key appears in logs.
10. No real LLM call required for CI.
