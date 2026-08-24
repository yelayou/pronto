# Pronto — CLAUDE.md

On-demand rides and package delivery across the GTA, dispatched entirely via WhatsApp. There is no app, no web interface for customers — everything happens through a WhatsApp conversation powered by a Claude AI agent and a human dispatcher who receives and acts on bookings.

---

## Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 14 (App Router) |
| Messaging | Twilio WhatsApp API |
| AI Agent | Claude via Vercel AI SDK + `@anthropic-ai/sdk` |
| Database | Supabase (Postgres) — service role key, server-side only |
| Maps | Google Maps Platform (geocoding + distance matrix) |
| CI/CD | GitHub Actions + Vercel |

---

## How the system works

There are two actors who message the Twilio number:

1. **Customers** — send a WhatsApp message to book a ride or package delivery. The Claude AI agent guides them through a multi-step conversation (service type → pickup → dropoff → passenger count / package details → payment method → confirmation). The conversation state is persisted per customer in Supabase.

2. **The dispatcher** — a single human operator identified by `DISPATCHER_PHONE`. They receive booking notifications and respond with short commands (`CONFIRM [ID]`, `DECLINE [ID]`, `ARRIVED`, `COMPLETE`, etc.) to progress bookings.

All inbound messages arrive at `POST /api/webhook`. The webhook checks `From` against `DISPATCHER_PHONE` to route to either the dispatcher handler or the customer handler.

---

## Project structure

```
src/
├── app/
│   ├── api/
│   │   ├── webhook/    ← Twilio inbound messages (main entry point)
│   │   ├── fare/       ← Fare calculation REST endpoint (POST)
│   │   └── health/     ← Health check / smoke test target (GET)
│   └── page.tsx
├── lib/
│   ├── fare/           ← Pure fare calculator, no side effects
│   ├── maps/           ← Google Maps geocoding + distance matrix
│   ├── twilio/         ← Twilio client + sendWhatsApp + signature validation
│   └── supabase/       ← Supabase service-role client (server-side only)
└── types/
    └── index.ts        ← All shared TypeScript types (single source of truth)

__tests__/
├── unit/               ← Pure function tests (Vitest) — fare calculator etc.
├── integration/        ← API route tests with mocked services (MSW)
└── e2e/                ← Full WhatsApp flow tests (Playwright, needs STAGING_URL)

scripts/
└── smoke.ts            ← Post-deploy smoke tests hitting /api/health
```

---

## Fare engine (`src/lib/fare/calculator.ts`)

The fare calculator is a pure function with no side effects. All monetary values are in CAD. HST (13%) is baked into the final total.

**Formula:**
```
time_cost  = durationMin × $0.74
dist_cost  = (km × $0.60) + max(0, (km − 35) × $0.30)   ← dead mileage tier at 35 km
trip_base  = max(time_cost, dist_cost)                    ← whichever is higher wins
subtotal   = trip_base + surcharges
pre_hst    = max(min_fare, subtotal × multiplier)
total      = pre_hst × 1.13
```

**Surcharges:**
- Heavy traffic: +$3.00 flat
- Small package: +$2.00
- Large package: +$5.00
- Fragile (packages only): +$3.00

**Multipliers:**
- Peak hours (7–9am, 4–7pm): ×1.5
- Late night (after 10pm): ×1.3

**Minimum fares:**
- Ride: $7.00 (pre-HST)
- Package: $8.00 (pre-HST)

**Benchmark:** 25 km / 30 min, normal hours, no surcharges → **$25.09** (HST included). This is the canonical test case.

**Customer-facing display:** A ±5% range is shown (`rangeL` / `rangeH`) so the customer sees e.g. *"$23.80 – $26.40 (HST included)"*.

---

## Dispatcher commands (WhatsApp)

| Command | Action |
|---|---|
| `ON DUTY Islington` | Activate bot, set current zone |
| `OFF DUTY` | Deactivate bot |
| `CONFIRM [ID]` | Accept booking, notify customer |
| `DECLINE [ID]` | Decline booking, notify customer |
| `ARRIVED` | Trigger payment instructions to customer |
| `COMPLETE` | Mark trip paid, close booking |
| `NOSHOW` | Log no-show, send $5 fee notice to customer |

---

## Customer conversation flow (`ConversationStage`)

```
idle
  → awaiting_service       (ride or package delivery?)
  → awaiting_pickup        (pickup address)
  → awaiting_dropoff       (drop-off address)
  → awaiting_pax           (rides only: how many passengers?)
  → awaiting_pkg_size      (packages only: small or large?)
  → awaiting_recipient     (packages only: recipient name)
  → awaiting_payment       (cash or e-transfer?)
  → awaiting_confirm       (show fare estimate, confirm booking)
  → confirmed              (booking created, dispatcher notified)
```

Conversation state is stored in Supabase per customer phone number.

---

## Key types (`src/types/index.ts`)

All shared types live in a single file. Key ones:

- `BookingRecord` — persisted booking with full fare breakdown, status, addresses, lat/lng
- `CustomerRecord` — phone, name, booking count, incident count
- `DispatcherState` — duty status, current zone, lat/lng
- `ConversationState` — per-customer conversation stage and collected fields
- `FareInput` / `FareResult` — fare calculator input/output
- `TwilioWebhookPayload` — raw Twilio POST fields
- `RouteResult` — distance matrix output (km, duration with/without traffic, heavy traffic flag)
- `BookingStatus` — `pending | confirmed | en_route | arrived | complete | declined | noshow | cancelled`

---

## API endpoints

### `POST /api/webhook`
Main Twilio webhook. Validates the `X-Twilio-Signature` header then either enqueues the job to QStash (when `QSTASH_TOKEN` is set) or processes synchronously (local dev fallback). Always responds with empty TwiML and HTTP 200 in <200ms so Twilio never times out or retries.

### `POST /api/worker`
QStash job processor. Receives async jobs published by `/api/webhook`. Validates the `upstash-signature` header using `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`, then calls `processWebhookPayload()` which handles all dispatcher and customer routing. Shared processor lives in `src/lib/webhook/processor.ts`.

### `POST /api/fare`
Accepts a `FareInput` JSON body, returns a `FareResult`. Used internally and useful for manual testing. Required fields: `distanceKm`, `durationMin`, `serviceType`, `timeOfDay`, `heavyTraffic`.

### `GET /api/health`
Returns `{ status: "ok", service: "pronto", timestamp }`. Used by smoke tests after deploys.

---

## Supabase (database)

The client in `src/lib/supabase/client.ts` uses the **service role key** — it bypasses Row Level Security. This is intentional (server-side only, never exposed to the browser). Never import this client in any client component.

---

## Twilio

`src/lib/twilio/client.ts` exports:
- `twilioClient` — the raw Twilio SDK client
- `sendWhatsApp(to, body)` — sends a WhatsApp message; auto-prepends `whatsapp:` prefix
- `validateTwilioSignature(signature, url, params)` — must be called in the webhook handler before processing any message

---

## Environment variables

```
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_WHATSAPP_NUMBER          # Your Twilio WhatsApp sender number
DISPATCHER_PHONE                # E.164 phone of the human dispatcher
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_MAPS_API_KEY
ANTHROPIC_API_KEY
STAGING_URL                     # Used by E2E and smoke tests only

# QStash async processing (PRT-36)
# When set, the webhook enqueues jobs to QStash instead of processing inline.
# If QSTASH_TOKEN is not set, the webhook falls back to synchronous processing (safe for local dev).
QSTASH_TOKEN                    # Upstash QStash publish token
QSTASH_CURRENT_SIGNING_KEY      # Used by /api/worker to verify QStash delivery signatures
QSTASH_NEXT_SIGNING_KEY         # Rotated signing key (QStash rotates keys periodically)
APP_BASE_URL                    # Optional: base URL for the worker callback (e.g. https://pronto.example.com)
                                # Defaults to https://$VERCEL_URL if not set
```

Both Twilio and Supabase clients throw at module load time if their required vars are missing — this surfaces misconfiguration immediately on startup.

---

## Testing

```bash
npm run test            # unit tests (Vitest) — fast, no network
npm run test:watch      # watch mode
npm run test:coverage   # coverage report
npm run test:e2e        # Playwright E2E — needs STAGING_URL
npm run smoke           # post-deploy smoke against /api/health
```

Unit tests live in `__tests__/unit/`. The fare calculator has comprehensive coverage — use `calculateFare` test cases as the canonical reference for fare logic. The benchmark test (25 km / 30 min → $25.09) must always pass.

Do not mock Supabase or Twilio in unit tests — use MSW in integration tests instead.

---

## CI/CD

| Trigger | Workflow | What runs |
|---|---|---|
| PR opened | `pr.yml` | lint + typecheck + unit tests + Vercel preview deploy |
| Merge to `main` | `staging.yml` | full test suite + staging deploy + smoke tests |
| Manual trigger | `production.yml` | type "DEPLOY" to confirm + prod deploy + smoke tests |

Production deploys are manual and require an explicit confirmation step.

---

## Development

```bash
npm run dev          # local dev server at localhost:3000
npx ngrok http 3000  # expose webhook to Twilio sandbox
# Set Twilio sandbox webhook URL to: https://YOUR_NGROK_URL/api/webhook
```

---

## Development workflow — Jira tickets required

**Before writing any code or making any meaningful change, a Jira ticket must exist.**

Use the PRT project at `yelayou.atlassian.net`. Choose the right type:

| Scope | Ticket type |
|---|---|
| Single focused change (new function, small fix, isolated feature) | **Story** |
| Defect / regression in existing behaviour | **Bug** |
| Cross-cutting feature spanning multiple stories | **Epic** |
| Small piece of work under an existing story | **Subtask** |

If you're unsure whether something is a Story or an Epic, default to Story — it can always be promoted later.

**Workflow:**
1. Create the ticket (or confirm an existing one covers the work)
2. Reference the ticket key (e.g. `PRT-42`) in commit messages and PR descriptions
3. Update ticket status as work progresses (In Progress → In Review → Done)
4. Close the ticket once the change is deployed and smoke tests pass

This applies to everything: new features, refactors, dependency upgrades, config changes, and bug fixes. The only exception is one-line typo fixes in comments or docs.

---

## In progress / TODO

Sprint 1 is active. All core customer and dispatcher handlers are implemented. Remaining work:

- `PRT-36` — Async webhook via QStash ✅ implemented, pending deploy + QStash setup in Upstash dashboard

### Recently completed (verified in code, Done in Jira)

- `PRT-33` — Idempotency check on booking creation using Twilio MessageSid — `deduplicateMessage()` in `src/lib/webhook/processor.ts`
- `PRT-34` — Conversation TTL (expire stale conversations after 2 hours of inactivity) — `isConversationExpired()` in `src/lib/customer/handler.ts`
- `PRT-61` — Conversational AI customer experience: NLU intent extraction, smart greetings, location disambiguation, natural language confirmation with fare estimate — see header comment in `src/lib/customer/handler.ts` (sub-tickets PRT-62–PRT-69)
