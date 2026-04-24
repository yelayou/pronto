# <img src="docs/steering-wheel.svg" alt="" width="32" height="32" align="left" /> Pronto

**On-demand rides and package delivery across the GTA — dispatched entirely via WhatsApp.**

> Fast. Local. Pronto.

There is no app and no customer-facing web UI. Customers book by texting a WhatsApp number; a Claude AI agent guides them through the flow and a single human dispatcher runs the fleet with short WhatsApp commands.

---

## Stack

| Layer       | Tool                                        |
|-------------|---------------------------------------------|
| Framework   | Next.js 14 (App Router)                     |
| Messaging   | Twilio WhatsApp API                         |
| AI agent    | Claude via Vercel AI SDK + `@anthropic-ai/sdk` |
| Database    | Supabase (Postgres, service-role, server-side only) |
| Maps        | Google Maps Platform (geocoding + distance matrix) |
| Async jobs  | Upstash QStash (webhook fan-out)            |
| CI/CD       | GitHub Actions + Vercel                     |

---

## How it works

Two actors message the Twilio number:

1. **Customers** — book a ride or package delivery through a multi-step WhatsApp conversation. State is persisted per phone number in Supabase.
2. **The dispatcher** — a single human operator identified by `DISPATCHER_PHONE`. They receive booking notifications and progress bookings with short commands.

All inbound messages arrive at `POST /api/webhook`. The webhook validates the Twilio signature, then either enqueues the job to QStash (when `QSTASH_TOKEN` is set) or processes it synchronously (local dev fallback). Either path runs through the shared processor in `src/lib/webhook/processor.ts`.

---

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/yelayou/pronto.git
cd pronto
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
# Fill in the values — see the Environment section below
```

### 3. Run locally

```bash
npm run dev
# App runs at http://localhost:3000
```

### 4. Expose the webhook to Twilio (local dev)

```bash
npx ngrok http 3000
# Twilio console → WhatsApp Sandbox → Webhook URL
# Set to: https://YOUR_NGROK_URL/api/webhook
```

If `QSTASH_TOKEN` is unset, the webhook processes synchronously — no QStash setup is required for local development.

---

## Environment

```
# Twilio — WhatsApp gateway
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_WHATSAPP_NUMBER          # e.g. whatsapp:+14155238886

# Supabase — service role key bypasses RLS (server-side only, never expose to browser)
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

# Google Maps — geocoding, distance matrix, geofence
GOOGLE_MAPS_API_KEY

# Anthropic — Claude agent
ANTHROPIC_API_KEY

# Dispatcher — E.164 phone of the human operator
DISPATCHER_PHONE

# Payment — Interac autodeposit email or link
ETRANSFER_LINK

# QStash — async webhook processing (optional locally; required in staging/prod)
QSTASH_TOKEN                    # Upstash publish token
QSTASH_CURRENT_SIGNING_KEY      # /api/worker verifies delivery signatures
QSTASH_NEXT_SIGNING_KEY         # Rotated signing key
APP_BASE_URL                    # Optional: worker callback base URL (defaults to https://$VERCEL_URL)

# App
NEXT_PUBLIC_APP_URL             # e.g. http://localhost:3000

# Test-only
STAGING_URL                     # Used by E2E + smoke tests
```

Both the Twilio and Supabase clients throw at module load time if required vars are missing — misconfiguration surfaces on startup, not on first request.

---

## API endpoints

| Endpoint           | Purpose |
|--------------------|---------|
| `POST /api/webhook` | Twilio inbound handler. Validates `X-Twilio-Signature`, then enqueues to QStash or processes inline. Always returns empty TwiML + HTTP 200 in <200 ms so Twilio never retries. |
| `POST /api/worker`  | QStash job processor. Validates `upstash-signature` with `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`, then calls the shared processor. |
| `POST /api/fare`    | Accepts a `FareInput` JSON body, returns a `FareResult`. Handy for manual testing. Requires `distanceKm`, `durationMin`, `serviceType`, `timeOfDay`, `heavyTraffic`. |
| `GET /api/health`   | `{ status: "ok", service: "pronto", timestamp }` — smoke-test target. |

---

## Dispatcher commands (WhatsApp)

| Command              | Action                                           |
|----------------------|--------------------------------------------------|
| `ON DUTY <zone>`     | Activate bot, set current zone                   |
| `OFF DUTY`           | Deactivate bot                                   |
| `CONFIRM [ID]`       | Accept booking, notify customer                  |
| `DECLINE [ID]`       | Decline booking, notify customer                 |
| `ARRIVED`            | Trigger payment instructions to customer         |
| `COMPLETE`           | Mark trip paid, close booking                    |
| `NOSHOW`             | Log no-show, send $5 fee notice                  |

---

## Customer conversation flow

```
idle
  → awaiting_service       ride or package?
  → awaiting_pickup        pickup address
  → awaiting_dropoff       drop-off address
  → awaiting_pax           rides: how many passengers?
  → awaiting_pkg_size      packages: small or large?
  → awaiting_recipient     packages: recipient name
  → awaiting_payment       cash or e-transfer?
  → awaiting_confirm       show fare estimate, confirm booking
  → confirmed              booking created, dispatcher notified
```

Conversation state is persisted in Supabase keyed on the customer's phone number.

---

## Fare engine

Pure function in `src/lib/fare/calculator.ts`. No side effects. All monetary values are CAD. HST (13%) is baked into the final total.

```
time_cost = minutes × $0.74
dist_cost = (km × $0.60) + max(0, (km − 35) × $0.30)    # dead-mileage tier at 35 km
trip_base = max(time_cost, dist_cost)                    # whichever is higher wins
subtotal  = trip_base + surcharges
pre_hst   = max(min_fare, subtotal × multiplier)
total     = pre_hst × 1.13
```

**Surcharges.** Heavy traffic +$3.00 · Small package +$2.00 · Large package +$5.00 · Fragile (packages only) +$3.00.

**Multipliers.** Peak (7–9 am, 4–7 pm) ×1.5 · Late night (after 10 pm) ×1.3.

**Minimum fares (pre-HST).** Ride $7.00 · Package $8.00.

**Benchmark.** 25 km / 30 min, normal hours, no surcharges → **$25.09** (HST included). This is the canonical test case and must always pass.

Customer-facing quotes show a ±5% range (`rangeL` / `rangeH`) — e.g. *"$23.80 – $26.40 (HST included)"*.

---

## Project structure

```
src/
├── app/
│   ├── api/
│   │   ├── fare/          ← Fare calculation endpoint (POST)
│   │   ├── health/        ← Health check / smoke-test target (GET)
│   │   ├── webhook/       ← Twilio inbound messages (main entry point)
│   │   └── worker/        ← QStash job processor
│   └── page.tsx
├── lib/
│   ├── customer/          ← Customer conversation handler
│   ├── dispatcher/        ← Dispatcher commands + handler
│   ├── fare/              ← Pure fare calculator (no side effects)
│   ├── geofence/          ← GTA geofence validator (ray-casting)
│   ├── maps/              ← Google Maps (geocoding, distance matrix)
│   ├── qstash/            ← QStash publish client
│   ├── supabase/          ← Supabase service-role client (server-side only)
│   ├── twilio/            ← Twilio client + sendWhatsApp + signature validation
│   └── webhook/           ← Shared processor used by /api/webhook + /api/worker
└── types/
    └── index.ts           ← All shared TypeScript types (single source of truth)

__tests__/
└── unit/                  ← Pure function tests (Vitest)

scripts/
└── smoke.ts               ← Post-deploy smoke tests

supabase/
└── migrations/            ← Supabase SQL migrations
```

Key types in `src/types/index.ts`: `BookingRecord`, `CustomerRecord`, `DispatcherState`, `ConversationState`, `FareInput`, `FareResult`, `RouteResult`, `TwilioWebhookPayload`, `BookingStatus`.

---

## Scripts

```bash
npm run dev            # local dev server
npm run build          # production build
npm run lint           # ESLint
npm run typecheck      # TypeScript check
npm run test           # unit tests (Vitest) — fast, no network
npm run test:watch     # watch mode
npm run test:coverage  # coverage report
npm run test:e2e       # E2E tests (Playwright, needs STAGING_URL)
npm run smoke          # post-deploy smoke against /api/health (needs STAGING_URL)
```

Do not mock Supabase or Twilio in unit tests — use MSW in integration tests instead.

---

## CI/CD

| Trigger         | Workflow          | What runs                                                |
|-----------------|-------------------|----------------------------------------------------------|
| PR opened       | `pr.yml`          | lint + typecheck + unit tests + Vercel preview deploy    |
| Merge to `main` | `staging.yml`     | full test suite + staging deploy + smoke tests           |
| Manual trigger  | `production.yml`  | type `DEPLOY` to confirm + prod deploy + smoke tests     |

Production deploys are manual by design and require an explicit confirmation step.

---

## Current status

Sprint 1 (Apr 20 – May 4, 2026) is active. Core customer and dispatcher handlers are implemented.

- **In PR:** `PRT-32` parallelise pickup/dropoff geocoding · `PRT-23` dispatcher notification with customer name + priority distance
- **Up next:** `PRT-36` async webhook via QStash (code in, pending QStash setup in Upstash) · `PRT-33` conversation TTL (expire stale conversations after 2 h)

Full roadmap lives in the [Pronto App Notion hub](https://www.notion.so/342b747b9e0d80efa1baed37900e324e).
