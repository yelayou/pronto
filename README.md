# Pronto 🚗

**On-demand rides and package delivery across the GTA — dispatched via WhatsApp.**

> Fast. Local. Pronto.

## Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 14 (App Router) |
| Messaging | Twilio WhatsApp API |
| AI Agent | Claude via Vercel AI SDK |
| Database | Supabase (Postgres) |
| Maps | Google Maps Platform |
| CI/CD | GitHub Actions + Vercel |

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/pronto.git
cd pronto
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
# Fill in all values in .env.local — see .env.example for descriptions
```

### 3. Run locally

```bash
npm run dev
# App runs at http://localhost:3000
```

### 4. Expose webhook to Twilio (local dev)

```bash
npx ngrok http 3000
# Copy the https URL → Twilio console → WhatsApp Sandbox → Webhook URL
# Set to: https://YOUR_NGROK_URL/api/webhook
```

## Scripts

```bash
npm run dev          # local dev server
npm run build        # production build
npm run lint         # ESLint
npm run typecheck    # TypeScript check
npm run test         # unit tests (Vitest)
npm run test:watch   # watch mode
npm run test:coverage # coverage report
npm run test:e2e     # E2E tests (Playwright, needs STAGING_URL)
npm run smoke        # post-deploy smoke tests (needs STAGING_URL)
```

## CI/CD

| Branch event | Workflow | What runs |
|---|---|---|
| PR opened | `pr.yml` | lint + typecheck + unit tests + preview deploy |
| Merge to main | `staging.yml` | full suite + staging deploy + smoke tests |
| Manual trigger | `production.yml` | confirm "DEPLOY" + prod deploy + smoke tests |

## Dispatcher commands (WhatsApp)

| Command | Action |
|---|---|
| `ON DUTY Islington` | Activate bot, set current zone |
| `OFF DUTY` | Deactivate bot |
| `CONFIRM [ID]` | Accept booking, notify customer |
| `DECLINE [ID]` | Decline booking, notify customer |
| `ARRIVED` | Trigger payment instructions |
| `COMPLETE` | Mark trip paid, close booking |
| `NOSHOW` | Log no-show, send $5 fee notice |

## Fare formula

```
time_cost  = minutes × $0.74
dist_cost  = (km × $0.60) + max(0, (km − 35) × $0.30)
trip_base  = max(time_cost, dist_cost)
subtotal   = trip_base + surcharges
total      = max(min_fare, subtotal × multiplier) × 1.13
```

Benchmark: 25 km / 30 min = **$25.09** (HST included)

## Project structure

```
src/
├── app/
│   ├── api/
│   │   ├── webhook/    ← Twilio inbound messages
│   │   ├── fare/       ← Fare calculation endpoint
│   │   └── health/     ← Health check / smoke test target
│   └── page.tsx
├── lib/
│   ├── fare/           ← Pure fare calculator (no side effects)
│   ├── maps/           ← Google Maps (geocoding, distance matrix)
│   ├── twilio/         ← Twilio client + send helpers
│   └── supabase/       ← Supabase client
└── types/
    └── index.ts        ← All shared TypeScript types
__tests__/
├── unit/               ← Pure function tests (Vitest)
├── integration/        ← API route tests with mocked services
└── e2e/                ← Full WhatsApp flow tests (Playwright)
scripts/
└── smoke.ts            ← Post-deploy smoke tests
```
