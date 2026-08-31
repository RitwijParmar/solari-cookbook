export class AegisError extends Error {}

export class IntentConflictError extends AegisError {}

export class AuditIntegrityError extends AegisError {}

export class InvalidTransitionError extends AegisError {}

export class AmbiguousOutcomeError extends AegisError {
  constructor(
    message: string,
    readonly fault: "before_send" | "after_commit_before_ack",
  ) {
    super(message)
  }
}

export class ReconciliationExhaustedError extends AegisError {}
