# Pronto — CLAUDE.md

WhatsApp-only ride and package delivery for the GTA. **See [README.md](README.md) for the stack, setup, env vars, API endpoints, fare formula, dispatcher commands, conversation stages, project structure, and CI/CD.** This file only covers what you need to know to change the code safely.

---

## Mental model

- **Claude is a parser, not an agent.** `src/lib/customer/intent.ts` makes one `extract_booking_fields` tool call per customer message. A deterministic TypeScript state machine drives the conversation. Don't add agent loops or let Claude choose the next stage.
- **One entry point, one processor.** `/api/webhook` (Twilio) and `/api/worker` (QStash) both call `processWebhookPayload()` in `src/lib/webhook/processor.ts`. That function rate-limits, dedups on `MessageSid`, then routes on `From === DISPATCHER_PHONE`. Put new cross-cutting behaviour there, not in either route.
- **Stage changes go through the transition map.** `ALLOWED_TRANSITIONS` / `assertValidTransition()` in `src/lib/customer/stateMachine.ts`. Adding a stage means updating `ConversationStage` in `src/types/index.ts`, the map, and `__tests__/unit/state-machine.test.ts`.
- **Conversation writes use optimistic locking** (`version` column). A `ConversationVersionError` means a concurrent message won; the processor drops it on purpose.

---

## Rules

- **Supabase client is service-role and server-only.** It bypasses RLS. Never import `src/lib/supabase/client.ts` from a client component.
- **Validate the Twilio signature** (`validateTwilioSignature`) before processing anything in the webhook. The worker verifies `upstash-signature` instead.
- **The webhook always returns empty TwiML + 200, fast.** Never let an error escape to Twilio, or it will retry.
- **Logging:** use `logger` from `src/lib/logger.ts`, never `console.*`, and mask phone numbers with `maskPhone()`.
- **External calls** (Maps, Twilio sends) go through `withRetry()` from `src/lib/retry.ts`.
- **Types** live in `src/types/index.ts` (single source of truth). **Required env vars** throw at module load (`src/lib/config.ts`, Twilio and Supabase clients). Keep it that way so misconfiguration fails on startup.
- **Fare calculator** (`src/lib/fare/calculator.ts`) stays a pure function. The benchmark **25 km / 30 min, normal hours, no surcharges → $25.09** must always pass.

---

## Testing

- Unit tests: `__tests__/unit/` (Vitest). Run `npm run test`, `npm run typecheck`, and `npm run lint` before opening a PR.
- **Do not mock Supabase or Twilio in unit tests.** Use MSW in integration tests instead. Mocking our own modules (e.g. the processor) or third-party SDKs like `@upstash/qstash` is fine.
- `__tests__/integration/` (MSW) and `__tests__/e2e/` (Playwright, needs `STAGING_URL`) are planned but not yet created.

---

## Workflow — Linear issues required

**Before writing any code or making any meaningful change, a Linear issue must exist** in the **SOL** team of the YG Lab workspace (`linear.app/yg-labs`). Pronto issues belong to one of the `Pronto — …` projects (setup & CI/CD, dispatcher, customer conversation flow, fare engine, booking & notifications, payment flow, maps & zone resolution, testing).

Label each issue `Feature`, `Improvement`, or `Bug` (defects and regressions). Use sub-issues for small pieces of an existing issue. Check for a matching issue before creating one.

1. Create the issue (or confirm an existing one covers the work) and move it to **In Progress**
2. Branch with a valid prefix and the issue key, e.g. `fix/sol-68-qstash-reliability`. Linear's suggested branch name (`yelayou/sol-…`) fails `branch-name.yml`, so don't use it as is. Reference the key (e.g. `SOL-68`) in commits and the PR title so Linear links the PR
3. Move it to **In Review** when the PR is open
4. Move it to **Done** once the change is deployed and staging smoke tests pass

This applies to everything (features, refactors, dependency upgrades, config, bug fixes) except one-line typo fixes in comments or docs. Production deploys are manual (`production.yml`, type `DEPLOY`).

**Old Jira keys:** commits before November 2026 reference Jira keys (`PRT-…`). Migrated issues map as **PRT-N → SOL-(N−8)**, e.g. PRT-76 → SOL-68. The Jira epics PRT-5–12 became the `Pronto — …` projects. The `PRT-…` keys in code comments are historical; leave them.

Keep README.md the single place for reference docs. Only add to this file what an AI assistant needs and the README doesn't cover.

---

## In progress / TODO

- QStash project setup in the Upstash dashboard, plus `QSTASH_*` and `APP_BASE_URL` in Vercel (staging, then production). Code is ready (SOL-28, SOL-68).
- Integration (MSW) and E2E (Playwright) test suites (SOL-22, SOL-23).
- Open from earlier reviews: least-privilege DB roles (SOL-49), circuit breakers (SOL-45), domain services split (SOL-35), API versioning (SOL-39), feature flags (SOL-46), secrets rotation (SOL-48), multi-dispatcher (SOL-32).
