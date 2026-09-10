# A11B Tests - Sarvam Provider Smoke

1. Without SARVAM_API_KEY, smoke command skips with clear message.
2. With SARVAM_API_KEY, smoke command completes and prints JSON.
3. Empty content from provider returns provider error, not TypeError/null.strip crash.
4. Invalid JSON triggers JSON repair or safe unknown.
5. API key is not printed.
6. Unit tests use mocked HTTP client, not real Sarvam.
