import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";

export const DOCUMENT_QUEUE = "documents";
export const ANALYSIS_QUEUE = "analyses";
export const NORMALIZE_DOCUMENT_JOB = "normalize-document";
export const EMBED_DOCUMENT_JOB = "embed-document";
export const ANALYZE_REQUIREMENT_JOB = "analyze-requirement";

export type DocumentJob = { documentId: string };
export type AnalysisJob = { runId: string };

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { count: 1_000 },
  removeOnFail: false,
};

export function createRedisConnection(url = process.env.REDIS_URL ?? "redis://localhost:6379") {
  return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

export function createQueues(connection = createRedisConnection()) {
  return {
    connection,
    documents: new Queue<DocumentJob>(DOCUMENT_QUEUE, { connection, defaultJobOptions }),
    analyses: new Queue<AnalysisJob>(ANALYSIS_QUEUE, { connection, defaultJobOptions }),
  };
}

export const normalizeJobId = (documentId: string, revision: number) => `normalize-${documentId}-${revision}`;
export const embedJobId = (documentId: string, hash: string, revision: number) =>
  `embed-${documentId}-${hash.slice(0, 12)}-${revision}`;
export const analysisJobId = (runId: string) => `analyze-${runId}`;
