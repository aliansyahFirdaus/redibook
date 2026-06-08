import type { AnalysisRun } from "./api";

const LAST_ACTIVE_ANALYSIS_ID_KEY = "redibook:last-active-analysis-id";
const LAST_ANALYSIS_ID_KEY = "redibook:last-analysis-id";

export const ACTIVE_ANALYSIS_STATUSES = ["queued", "retrieving", "analyzing"] as const;

export function isActiveAnalysisStatus(status: AnalysisRun["status"] | undefined): boolean {
  return ACTIVE_ANALYSIS_STATUSES.includes(status as (typeof ACTIVE_ANALYSIS_STATUSES)[number]);
}

export function findActiveAnalysis(runs: AnalysisRun[] | undefined): AnalysisRun | undefined {
  return runs?.find((run) => isActiveAnalysisStatus(run.status));
}

export function getLastActiveAnalysisId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_ACTIVE_ANALYSIS_ID_KEY);
}

export function setLastActiveAnalysisId(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_ACTIVE_ANALYSIS_ID_KEY, id);
}

export function clearLastActiveAnalysisId(id?: string): void {
  if (typeof window === "undefined") return;
  if (id && getLastActiveAnalysisId() !== id) return;
  window.localStorage.removeItem(LAST_ACTIVE_ANALYSIS_ID_KEY);
}

export function getLastAnalysisId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_ANALYSIS_ID_KEY);
}

export function setLastAnalysisId(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_ANALYSIS_ID_KEY, id);
}

export function clearLastAnalysisId(id?: string): void {
  if (typeof window === "undefined") return;
  if (id && getLastAnalysisId() !== id) return;
  window.localStorage.removeItem(LAST_ANALYSIS_ID_KEY);
}
