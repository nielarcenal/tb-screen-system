# Task 6.4 — SMS delivery-state feasibility review

Date: 2026-09-10
Reviewer: Codex
Decision: **DEFER provider delivery callbacks and new retry behavior from this sprint.**

## Evidence from the current implementation

- `sms-reminders/gateway.ts` returns `sent` as soon as Semaphore or TextBee accepts an
  HTTP request. Its own contract explicitly says this is not handset delivery.
- Semaphore's successful response body is not parsed or stored. TextBee returns an
  `smsBatchId`, but the implementation intentionally discards it. Therefore `sms_log`
  has no provider message identifier that a callback or polling job could correlate.
- There is no authenticated delivery-callback endpoint, callback signature validation,
  replay protection, or monotonic transition rule for out-of-order callbacks.
- The existing send path already reserves `queued` before network I/O. Follow-up failures
  and abandoned reservations are retried with a hard cap of three; scheduled reminders
  deliberately do not retry because their same-day send is the final backstop and an
  ambiguous network failure can already have reached the handset.

The implementation can safely claim only:

```text
queued   = attempt reserved before provider call
sent     = provider accepted the request; delivery is unknown
failed   = provider HTTP/request failure; delivery is not established
stubbed  = development path; nothing was sent
```

## Why Task 6.5 is deferred

Adding `accepted`, `delivered`, `failed`, and retry states safely is not a label change.
It first requires a provider-specific message ID, provider identity, authenticated
callbacks or bounded polling, idempotent/out-of-order state transitions, timestamped
attempt history, and evidence about whether each failure class is safe to retry. Without
those pieces, a retry after an ambiguous timeout can duplicate a reminder, and a `delivered`
label would be an unsupported claim.

Do not add delivery callbacks or expand retries during the seven-day release path. The
safe Day 6 client change is wording only: wherever `sent` is displayed, render it as
"accepted by provider (delivery unknown)" in all supported languages. Keep the stored
value unchanged so existing selection and idempotency behavior remains stable.

## Revisit criteria

Reopen Task 6.5 only after one production provider is selected and its primary callback
or status-query contract is reviewed. The design must include provider IDs, callback
authentication, replay/out-of-order tests, retry classification and caps, and a migration
plan for existing `sent` rows whose delivery can never be reconstructed.
