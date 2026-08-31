# Aegis Commit architecture

## Safety objective

For an operation identified by `(tenant_id, business_key)`, at most one target
effect may be committed for one canonical intent. A caller may receive the same
receipt repeatedly, but the target's `effects` counter must never exceed one.

The protocol separates three facts that browser automation often conflates:

1. **dispatch attempted** — the browser tried to send a request;
2. **acknowledgement observed** — the browser saw a success response; and
3. **effect committed** — the target durably applied the mutation.

Only the target can authoritatively establish the third fact.

## Invariants

### I1 — stable identity

`operation_id = H(tenant_id || business_key)` and
`idempotency_key = H(operation_id || canonical_intent_hash)`.

The business key cannot be rebound to another amount or destination. The
coordinator rejects a concurrent or later mismatch before dispatch.

### I2 — write before effect

`operation_prepared` and `dispatch_started` are appended and synchronized before
the target call. This leaves enough evidence to reconcile after process loss.

### I3 — no blind retry

An ambiguous attempt transitions to `outcome_unknown`. A second dispatch is
legal only after `lookup(idempotency_key)` returns authoritative absence.

### I4 — receipt binding

Before recording `effect_committed`, the coordinator verifies the receipt's
idempotency key, intent hash, and amount against the prepared operation.

### I5 — single owner per process

The in-flight map coalesces concurrent callers by operation ID and rejects a
different intent hash. Multi-process deployments require a database lease or
fencing token; the implementation does not pretend an in-memory lock is enough.

### I6 — audit integrity

Each event hash covers sequence, operation ID, type, time, payload, and previous
hash. Recovery stops on a sequence gap, predecessor mismatch, or changed hash.

## Liveness

Safety wins over automatic progress. If the target cannot answer whether an
effect exists and does not honor an idempotency key, the coordinator stops.
Human resolution is preferable to an unbounded duplicate side effect.

With a reachable lookup and idempotent submit, the operation converges to
`committed` after either the original acknowledgement, a matching reconciliation
receipt, or one verified-absent retry.

## Adapter boundary

`EffectTarget` exposes only three operations:

- `submit(prepared_operation, fault_options)`;
- `lookup(prepared_operation)`; and
- `stats()` for evidence.

The deterministic adapter explores schedules cheaply. The Solari adapter uses a
real browser for both dispatch and recovery and a sandbox-hosted target for the
authoritative state. Neither adapter changes coordinator semantics.

## Production extensions

- PostgreSQL WAL with `SELECT … FOR UPDATE SKIP LOCKED` and fencing epochs;
- signed target receipts and clock-independent ordering;
- explicit saga compensation for non-idempotent legacy actions;
- per-target retry budgets and circuit breakers;
- OpenTelemetry spans keyed by operation ID; and
- policy approval between `prepared` and `dispatch_started`.
