const API_BASE_URL = import.meta.env.SSR
  ? process.env.API_BASE_URL ?? "http://localhost:3001/api/v1"
  : import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001/api/v1";

export type QualityResult = {
  score: number;
  issues: string[];
  missingElements: Array<"actor" | "behavior" | "conditions" | "constraints" | "acceptanceCriteria">;
};

export type SourceGroupSummary = {
  id: string;
  type: "sprint" | "feature";
  name: string;
  outlineUrl: string | null;
};

export type SourceGroup = SourceGroupSummary & {
  createdAt: string;
  updatedAt: string;
};

export type Source = {
  id: string;
  sourceType: "manual" | "outline";
  title: string;
  indexStatus: "pending" | "normalizing" | "embedding" | "ready" | "failed";
  indexError: string | null;
  outlineUrl: string | null;
  outlinePath: string[];
  outlineOrder: number[];
  collectionName: string | null;
  sprintGroups: SourceGroupSummary[];
  featureGroups: SourceGroupSummary[];
  createdAt: string;
  updatedAt: string;
};

export type ImpactAnalysisResult = {
  summary: string;
  affectedKnowledge: Array<{
    knowledge: string;
    impact: string;
    evidenceChunkIds: string[];
  }>;
  possibleConflicts: Array<{
    conflict: string;
    severity: "low" | "medium" | "high";
    evidenceChunkIds: string[];
  }>;
  missingQuestions: string[];
  suggestedTests: string[];
  evidence: Array<{
    chunkId: string;
    title: string;
    section: string | null;
    excerpt: string;
  }>;
};

export type LegacyDeliveryAnalysisResult = {
  summary: string;
  inputDocuments: Array<{
    sourceDocumentId?: string;
    outlineDocumentId?: string;
    title: string;
    outlinePath: string[];
  }>;
  impactedAreas: Array<{
    area: string;
    impact: string;
    evidenceChunkIds: string[];
  }>;
  possibleConflicts: Array<{
    conflict: string;
    severity: "low" | "medium" | "high";
    evidenceChunkIds: string[];
  }>;
  dependencies: Array<{
    dependency: string;
    rationale: string;
    evidenceChunkIds: string[];
  }>;
  missingClarifications: string[];
  evidence: Array<{
    chunkId: string;
    title: string;
    section: string | null;
    excerpt: string;
  }>;
};

export type PerDocDeliveryAnalysisResult = {
  documents: Array<{
    inputDocument: {
      sourceDocumentId?: string;
      outlineDocumentId?: string;
      title: string;
      outlinePath: string[];
    };
    summary: string;
    impactedAreas: Array<{
      area: string;
      impact: string;
      evidenceChunkIds: string[];
    }>;
    possibleConflicts: Array<{
      conflict: string;
      severity: "low" | "medium" | "high";
      evidenceChunkIds: string[];
    }>;
    dependencies: Array<{
      dependency: string;
      rationale: string;
      evidenceChunkIds: string[];
    }>;
    missingClarifications: string[];
    evidence: Array<{
      chunkId: string;
      title: string;
      section: string | null;
      excerpt: string;
    }>;
  }>;
};

export type DeliveryAnalysisResult = LegacyDeliveryAnalysisResult | PerDocDeliveryAnalysisResult;

export type AnalysisRun = {
  id: string;
  requirement: string;
  status: "queued" | "retrieving" | "analyzing" | "completed" | "failed";
  mode: "requirement" | "delivery";
  sourceGroup: SourceGroupSummary | null;
  deliveryReference: {
    url: string | null;
    documentId: string;
    title: string;
  } | null;
  inputPrompt: string | null;
  quality: QualityResult;
  result: ImpactAnalysisResult | DeliveryAnalysisResult | null;
  provider: string | null;
  model: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Request failed with ${response.status}`);
  }
  return body as T;
}
