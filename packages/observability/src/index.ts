import * as Sentry from "@sentry/node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { startObservation } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

let telemetrySdk: NodeSDK | null = null;

export async function initializeObservability(environment = process.env): Promise<void> {
  if (environment.SENTRY_DSN) {
    Sentry.init({ dsn: environment.SENTRY_DSN, enabled: true });
  }
  if (
    environment.LANGFUSE_PUBLIC_KEY
    && environment.LANGFUSE_SECRET_KEY
    && environment.LANGFUSE_BASE_URL
  ) {
    telemetrySdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] });
    telemetrySdk.start();
  }
}

export async function shutdownObservability(): Promise<void> {
  await telemetrySdk?.shutdown();
  await Sentry.close(2_000);
  telemetrySdk = null;
}

export async function observe<T>(
  name: string,
  type: "span" | "retriever" | "embedding" | "generation",
  metadata: Record<string, unknown>,
  operation: () => Promise<T>,
): Promise<T> {
  if (!telemetrySdk) return operation();
  const observation = type === "generation"
    ? startObservation(name, { metadata }, { asType: "generation" })
    : type === "embedding"
      ? startObservation(name, { metadata }, { asType: "embedding" })
      : type === "retriever"
        ? startObservation(name, { metadata }, { asType: "retriever" })
        : startObservation(name, { metadata }, { asType: "span" });
  try {
    const result = await operation();
    observation.update({ output: summarize(result) });
    return result;
  } catch (error) {
    observation.update({ level: "ERROR", statusMessage: error instanceof Error ? error.message : String(error) });
    Sentry.captureException(error);
    throw error;
  } finally {
    observation.end();
  }
}

function summarize(value: unknown): unknown {
  if (Array.isArray(value)) return { count: value.length };
  if (value && typeof value === "object") return { type: value.constructor?.name ?? "object" };
  return value;
}
