export type OperationState =
  | "prepared"
  | "dispatching"
  | "outcome_unknown"
  | "committed"
  | "aborted"

export type FaultPoint = "none" | "before_send" | "after_commit_before_ack"

export interface EffectIntent {
  readonly tenantId: string
  readonly businessKey: string
  readonly accountId: string
  readonly destination: string
  readonly amountCents: number
  readonly currency: "USD"
  readonly reason: string
}

export interface PreparedOperation {
  readonly operationId: string
  readonly idempotencyKey: string
  readonly intentHash: string
  readonly intent: EffectIntent
}

export interface EffectReceipt {
  readonly receiptId: string
  readonly idempotencyKey: string
  readonly intentHash: string
  readonly committedAt: string
  readonly amountCents: number
}

export interface TargetStats {
  readonly requests: number
  readonly effects: number
}

export interface EffectTarget {
  submit(
    operation: PreparedOperation,
    options: { readonly fault: FaultPoint },
  ): Promise<EffectReceipt>
  lookup(operation: PreparedOperation): Promise<EffectReceipt | null>
  stats(): Promise<TargetStats>
}

export type AuditEventType =
  | "operation_prepared"
  | "dispatch_started"
  | "outcome_unknown"
  | "reconciliation_started"
  | "effect_observed"
  | "retry_approved"
  | "effect_committed"
  | "operation_aborted"

export interface AuditEvent {
  readonly sequence: number
  readonly operationId: string
  readonly type: AuditEventType
  readonly at: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly previousHash: string
  readonly hash: string
}

export interface OperationProjection {
  readonly operation: PreparedOperation
  readonly state: OperationState
  readonly receipt: EffectReceipt | null
  readonly events: readonly AuditEvent[]
}

export interface ExecutionResult {
  readonly projection: OperationProjection
  readonly target: TargetStats
  readonly recovered: boolean
  readonly duplicatePrevented: boolean
}
