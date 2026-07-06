# Pronto — Failure Modes & Graceful Degradation

_PRT-41 — last updated 2026-07-06_

All webhook paths return HTTP 200 to Twilio unconditionally. Non-200 responses cause Twilio to retry the webhook, which would duplicate bookings and compound any outage.

---

## External dependencies

| Dependency | Used for | Failure mode |
|---|---|---|
| Supabase | Conversation state, bookings, customers, dispatcher state | DB error / connection refused |
| Google Maps | Geocoding, route distance + duration | Timeout (>5 s per attempt), API quota, network error |
| Twilio | Outbound WhatsApp messages | 5xx from Twilio API, network error |
| Upstash QStash | Async webhook delivery | Enqueue failure |
| Upstash Redis | Per-phone rate limiting | Connection error (falls back to in-memory) |

---

## Failure scenarios

### Supabase unavailable

**Trigger:** DB connection refused, network partition, or Supabase outage.

**Behaviour:**
- Any Supabase call throws a JS `Error`.
- The customer handler propagates the error up.
- `processor.ts` catches unhandled errors, sends the customer: _"We're experiencing a brief outage — please try again in a few minutes 🙏"_, then re-throws so the worker logs it.
- The worker returns HTTP 200 to QStash (no retry).

**Recovery:** Customer retries when Supabase recovers. No state corruption — the failed write never happened.

---

### Google Maps timeout or unavailable

**Trigger:** Maps API takes >5 s per attempt, quota exhausted, or network error.

**Behaviour:**
- Each `fetch` in `maps/client.ts` has a 5 s `AbortSignal.timeout`.
- `withRetry` retries up to 3× (exponential backoff). `TimeoutError` and `TypeError` are both retryable.
- After all retries exhausted, the Maps function throws.
- In `buildAndShowConfirmation`, geocoding and `getRoute` calls are wrapped in `try/catch` — any error is treated as a null result.
- When route is null the customer receives: _"Sorry, I couldn't calculate the route right now. Could you confirm your addresses? Reply yes to retry or type a corrected address."_
- No booking is created. Conversation stage stays at `awaiting_confirm`, so the customer can retry.

**Recovery:** Customer replies "yes" to retry fare calculation once Maps recovers.

---

### Twilio outbound send failure

**Trigger:** Twilio 5xx, network error sending a WhatsApp message.

**Behaviour:**
- `sendWhatsApp` is wrapped with `withRetry` (3 attempts, exponential backoff). 4xx errors are not retried.
- If all retries fail, the send throws.
- **During booking flow:** `submitBooking` treats the dispatcher notification send separately — failure is caught and logged, booking stays in DB with `dispatcher_notified = false`. The customer still gets their confirmation reply (it uses a separate send call).
- **Recovery of un-notified bookings:** When the dispatcher sends `QUEUE` or goes `ON DUTY`, all `pending` bookings with `dispatcher_notified = false` are surfaced and marked as notified.

---

### QStash enqueue failure

**Trigger:** `QSTASH_TOKEN` is set but the Upstash API is unreachable when the webhook arrives.

**Behaviour:**
- `enqueueWebhookJob` throws.
- `/api/webhook` catches it, logs the error, and still returns HTTP 200 to Twilio.
- The inbound message is lost — it will not be processed.

**Mitigation:** QStash itself has >99.9% uptime. No retry is attempted from our side to avoid duplicate processing. If this becomes a concern, add a dead-letter fallback (sync processing when enqueue fails).

---

### Upstash Redis unavailable (rate limiting)

**Trigger:** `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are set but Redis is unreachable.

**Behaviour:**
- `checkRateLimit` falls back to the in-process `Map` store automatically.
- Rate limits continue to work per-instance but are not coordinated across serverless instances.
- No customer impact during the outage beyond slightly relaxed per-instance limits.

---

## HTTP 200 guarantee

Both `/api/webhook` and `/api/worker` always return HTTP 200, even on errors:

- `/api/webhook` — try/catch around `enqueueWebhookJob` and `processWebhookPayload`; always returns TwiML 200.
- `/api/worker` — try/catch around `processWebhookPayload`; always returns `OK` 200.

This prevents Twilio from retrying webhooks and QStash from requeuing failed jobs for errors that are unlikely to resolve on retry.
