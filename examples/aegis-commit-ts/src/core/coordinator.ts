import type { AuditLog } from "./audit.js"
import {
  AmbiguousOutcomeError,
  IntentConflictError,
  ReconciliationExhaustedError,
} from "./errors.js"
import { prepareOperation, projectOperation } from "./operation.js"
import type {
  EffectIntent,
  EffectReceipt,
  EffectTarget,
  ExecutionResult,
  FaultPoint,
  OperationProjection,
  PreparedOperation,
} from "./types.js"

export class ExactlyOnceCoordinator {
  private readonly inFlight = new Map<
    string,
    { readonly intentHash: string; readonly promise: Promise<ExecutionResult> }
  >()

  constructor(
    private readonly audit: AuditLog,
    private readonly target: EffectTarget,
  ) {}

  async execute(
    intent: EffectIntent,
    options: { readonly fault?: FaultPoint } = {},
  ): Promise<ExecutionResult> {
    const candidate = prepareOperation(intent)
    const existing = this.inFlight.get(candidate.operationId)
    if (existing !== undefined) {
      if (existing.intentHash !== candidate.intentHash) {
        throw new IntentConflictError(
          `Business key ${intent.businessKey} is concurrently bound to a different intent.`,
        )
      }
      return existing.promise
    }

    const run = this.executeOwned(candidate, options.fault ?? "none").finally(() => {
      this.inFlight.delete(candidate.operationId)
    })
    this.inFlight.set(candidate.operationId, { intentHash: candidate.intentHash, promise: run })
    return run
  }

  private async executeOwned(
    candidate: PreparedOperation,
    fault: FaultPoint,
  ): Promise<ExecutionResult> {
    const operation = await this.ensurePrepared(candidate)
    const current = await this.projection(operation.operationId)
    if (current.state === "committed") {
      return this.result(current, true, true)
    }
    return this.run(operation, fault)
  }

  async projection(operationId: string): Promise<OperationProjection> {
    return projectOperation(await this.audit.list(operationId))
  }

  private async ensurePrepared(operation: PreparedOperation): Promise<PreparedOperation> {
    const existing = await this.audit.list(operation.operationId)
    if (existing.length === 0) {
      await this.audit.append(operation.operationId, "operation_prepared", { operation })
      return operation
    }
    const projected = projectOperation(existing)
    if (projected.operation.intentHash !== operation.intentHash) {
      throw new IntentConflictError(
        `Business key ${operation.intent.businessKey} was already bound to a different intent.`,
      )
    }
    return projected.operation
  }

  private async run(operation: PreparedOperation, fault: FaultPoint): Promise<ExecutionResult> {
    let projection = await this.projection(operation.operationId)
    if (projection.state === "outcome_unknown" || projection.state === "dispatching") {
      return this.reconcile(operation, true)
    }

    await this.audit.append(operation.operationId, "dispatch_started", {
      attempt: 1,
      fault,
    })
    try {
      const receipt = await this.target.submit(operation, { fault })
      projection = await this.commit(operation, receipt, "direct_ack")
      return this.result(projection, false, false)
    } catch (error) {
      if (!(error instanceof AmbiguousOutcomeError)) throw error
      await this.audit.append(operation.operationId, "outcome_unknown", {
        fault: error.fault,
        reason: error.message,
      })
      return this.reconcile(operation, true)
    }
  }

  private async reconcile(
    operation: PreparedOperation,
    recovered: boolean,
  ): Promise<ExecutionResult> {
    await this.audit.append(operation.operationId, "reconciliation_started", {})
    const observed = await this.target.lookup(operation)
    if (observed !== null) {
      this.assertReceipt(operation, observed)
      await this.audit.append(operation.operationId, "effect_observed", {
        receiptId: observed.receiptId,
      })
      const projection = await this.commit(operation, observed, "read_after_unknown")
      return this.result(projection, recovered, true)
    }

    await this.audit.append(operation.operationId, "retry_approved", {
      reason: "authoritative lookup found no effect",
    })
    await this.audit.append(operation.operationId, "dispatch_started", {
      attempt: 2,
      fault: "none",
    })
    try {
      const receipt = await this.target.submit(operation, { fault: "none" })
      const projection = await this.commit(operation, receipt, "verified_retry")
      return this.result(projection, recovered, false)
    } catch (error) {
      await this.audit.append(operation.operationId, "operation_aborted", {
        reason: error instanceof Error ? error.message : String(error),
      })
      throw new ReconciliationExhaustedError("Verified retry failed; operation was aborted.")
    }
  }

  private async commit(
    operation: PreparedOperation,
    receipt: EffectReceipt,
    path: string,
  ): Promise<OperationProjection> {
    this.assertReceipt(operation, receipt)
    await this.audit.append(operation.operationId, "effect_committed", { receipt, path })
    return this.projection(operation.operationId)
  }

  private assertReceipt(operation: PreparedOperation, receipt: EffectReceipt): void {
    if (
      receipt.idempotencyKey !== operation.idempotencyKey ||
      receipt.intentHash !== operation.intentHash ||
      receipt.amountCents !== operation.intent.amountCents
    ) {
      throw new IntentConflictError("Target receipt does not match the prepared intent.")
    }
  }

  private async result(
    projection: OperationProjection,
    recovered: boolean,
    duplicatePrevented: boolean,
  ): Promise<ExecutionResult> {
    return {
      projection,
      target: await this.target.stats(),
      recovered,
      duplicatePrevented,
    }
  }
}
