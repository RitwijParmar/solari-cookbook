import { ROOT_CONTEXT, trace } from "@opentelemetry/api"
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base"

export interface ExportedSpan {
  readonly name: string
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly durationMs: number
  readonly attributes: Readonly<Record<string, string | number | boolean>>
}

export class RunTelemetry {
  private readonly exporter = new InMemorySpanExporter()
  private readonly provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(this.exporter)],
  })
  private readonly tracer = this.provider.getTracer("ghostack-control-plane", "1.0.0")
  private readonly root = this.tracer.startSpan("ghostack.chaos_run")
  private readonly rootContext = trace.setSpan(ROOT_CONTEXT, this.root)

  readonly traceId = this.root.spanContext().traceId

  record(phase: string, attributes: Readonly<Record<string, string>>): { traceId: string; spanId: string } {
    const span = this.tracer.startSpan(`ghostack.${phase}`, { attributes }, this.rootContext)
    const context = span.spanContext()
    span.end()
    return { traceId: context.traceId, spanId: context.spanId }
  }

  async finish(status: string): Promise<readonly ExportedSpan[]> {
    this.root.setAttribute("ghostack.status", status)
    this.root.end()
    await this.provider.forceFlush()
    const spans = this.exporter.getFinishedSpans().map(exportSpan)
    await this.provider.shutdown()
    return spans
  }
}

function exportSpan(span: ReadableSpan): ExportedSpan {
  const durationMs = Math.round((span.duration[0] * 1_000) + (span.duration[1] / 1_000_000))
  const parentSpanId = span.parentSpanContext?.spanId
  return {
    name: span.name,
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    ...(parentSpanId === undefined ? {} : { parentSpanId }),
    durationMs,
    attributes: span.attributes as Readonly<Record<string, string | number | boolean>>,
  }
}
