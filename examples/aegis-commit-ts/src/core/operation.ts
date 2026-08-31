import { IntentConflictError, InvalidTransitionError } from "./errors.js"
import { hashObject, sha256 } from "./hash.js"
import type {
  AuditEvent,
  EffectIntent,
  EffectReceipt,
  OperationProjection,
  OperationState,
  PreparedOperation,
} from "./types.js"

export function prepareOperation(intent: EffectIntent): PreparedOperation {
  if (!Number.isSafeInteger(intent.amountCents) || intent.amountCents <= 0) {
    throw new IntentConflictError("Amount must be a positive integer number of cents.")
  }
  const intentHash = hashObject(intent)
  const operationId = `op_${sha256(`${intent.tenantId}:${intent.businessKey}`).slice(0, 24)}`
  const idempotencyKey = `aeg_${sha256(`${operationId}:${intentHash}`).slice(0, 32)}`
  return { operationId, idempotencyKey, intentHash, intent }
}

function stateAfter(event: AuditEvent): OperationState | null {
  switch (event.type) {
    case "operation_prepared":
      return "prepared"
    case "dispatch_started":
      return "dispatching"
    case "outcome_unknown":
    case "reconciliation_started":
    case "effect_observed":
    case "retry_approved":
      return "outcome_unknown"
    case "effect_committed":
      return "committed"
    case "operation_aborted":
      return "aborted"
  }
}

export function projectOperation(events: readonly AuditEvent[]): OperationProjection {
  const first = events[0]
  if (first?.type !== "operation_prepared") {
    throw new InvalidTransitionError("An operation must begin with operation_prepared.")
  }
  const operation = first.payload.operation as PreparedOperation | undefined
  if (operation === undefined) {
    throw new InvalidTransitionError("Prepared event is missing its operation payload.")
  }
  let state: OperationState = "prepared"
  let receipt: EffectReceipt | null = null
  for (const event of events) {
    state = stateAfter(event) ?? state
    if (event.type === "effect_committed") {
      receipt = (event.payload.receipt as EffectReceipt | undefined) ?? null
    }
  }
  return { operation, state, receipt, events }
}
