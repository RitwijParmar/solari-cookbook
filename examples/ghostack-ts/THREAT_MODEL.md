# Threat model

## Protected properties

- one business key cannot produce two financial effects;
- a changed intent cannot inherit another intent's idempotency key;
- audit evidence cannot be modified without detection; and
- Solari credentials cannot enter source, target state, or generated evidence.

## Trust boundaries

| Boundary | Trusted for | Not trusted for |
| --- | --- | --- |
| Aegis coordinator | state-machine decisions and intent canonicalization | target commit status without a receipt |
| Solari browser | performing the requested UI flow | surviving long enough to observe acknowledgement |
| Sandbox target | authoritative receipt and idempotent mutation | protecting production money; the demo is synthetic |
| JSONL audit file | durable local append after `fsync` | multi-host consensus or rollback resistance |
| Public preview URL | demo transport | authentication for real financial operations |

## Addressed failures

- browser, tab, or network loss around the acknowledgement boundary;
- duplicate callers and replayed commands;
- idempotency-key reuse with mutated payloads;
- partial or edited local audit history;
- oversized or malformed target requests; and
- leaked remote resources after exceptions.

## Deliberate non-claims

- SHA-256 chaining detects edits but is not an external timestamp or signature.
- Local `fsync` does not provide multi-region durability.
- Exactly-once cannot be synthesized for a destination with no idempotency and
  no authoritative read.
- The example target has no user authentication because it moves no money and
  lives only for the duration of a sandbox run.

## Secret handling

`SOLARI_API_KEY` is read from the process environment. It is never interpolated
into the target program, browser page, command output, evidence schema, or Git
history. `.env` files and dependencies are ignored by the repository.
