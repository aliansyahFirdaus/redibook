import { describe, expect, it } from "vitest";
import {
  createAnalysisInputSchema,
  deliveryAnalysisResultSchema,
  impactAnalysisResultSchema,
  outlineCollectionSyncInputSchema,
  outlineSyncInputSchema,
  validateDeliveryModelEvidence,
  validateModelEvidence,
} from "./index.js";

const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

describe("evidence validation", () => {
  it("accepts claims backed by listed evidence", () => {
    expect(impactAnalysisResultSchema.parse({
      summary: "A summary",
      affectedKnowledge: [{ knowledge: "Login", impact: "Lock it", evidenceChunkIds: [id] }],
      possibleConflicts: [],
      missingQuestions: [],
      suggestedTests: ["Locks after five failures"],
      evidence: [{ chunkId: id, title: "Auth", section: "Login", excerpt: "Three attempts." }],
    }).summary).toBe("A summary");
  });

  it("rejects un-retrieved model evidence", () => {
    expect(() => validateModelEvidence({
      summary: "A summary",
      affectedKnowledge: [{ knowledge: "Login", impact: "Lock it", evidenceChunkIds: [other] }],
      possibleConflicts: [],
      missingQuestions: [],
      suggestedTests: [],
      evidenceChunkIds: [other],
    }, [id])).toThrow(/un-retrieved/);
  });

  it("accepts delivery results backed by listed evidence", () => {
    expect(deliveryAnalysisResultSchema.parse({
      documents: [{
        inputDocument: {
          outlineDocumentId: "payroll-export-Lw4fJ5Qx",
          title: "Sprint 3 / Payroll export",
          outlinePath: ["Sprint 3", "Payroll export"],
        },
        summary: "Payroll export touches existing CSV guidance.",
        impactedAreas: [{ area: "Payroll export", impact: "Reconcile CSV columns.", evidenceChunkIds: [id] }],
        possibleConflicts: [],
        dependencies: [],
        missingClarifications: [],
        evidence: [{ chunkId: id, title: "Payroll export", section: "CSV", excerpt: "Columns changed." }],
      }],
    })).toMatchObject({
      documents: [{
        inputDocument: { title: "Sprint 3 / Payroll export" },
      }],
    });
  });

  it("continues to accept legacy delivery results", () => {
    expect(deliveryAnalysisResultSchema.parse({
      summary: "Sprint 3 affects payroll guidance.",
      inputDocuments: [{
        outlineDocumentId: "payroll-export-Lw4fJ5Qx",
        title: "Sprint 3 / Payroll export",
        outlinePath: ["Sprint 3", "Payroll export"],
      }],
      impactedAreas: [{ area: "Payroll export", impact: "Reconcile CSV columns.", evidenceChunkIds: [id] }],
      possibleConflicts: [],
      dependencies: [],
      missingClarifications: [],
      evidence: [{ chunkId: id, title: "Payroll export", section: "CSV", excerpt: "Columns changed." }],
    })).toMatchObject({
      summary: expect.stringContaining("Sprint 3"),
    });
  });

  it("rejects un-retrieved delivery evidence", () => {
    expect(() => validateDeliveryModelEvidence({
      summary: "A summary",
      impactedAreas: [{ area: "Payroll", impact: "Update export", evidenceChunkIds: [other] }],
      possibleConflicts: [],
      dependencies: [],
      missingClarifications: [],
      evidenceChunkIds: [other],
    }, [id])).toThrow(/un-retrieved/);
  });
});

describe("outline source inputs", () => {
  it("accepts outline document sync by URL or document ID", () => {
    expect(outlineSyncInputSchema.parse({ url: "https://docs.example.com/doc/crew-lvvQXRsfmu" }).url).toContain("/doc/");
    expect(outlineSyncInputSchema.parse({ documentId: "crew-lvvQXRsfmu" }).documentId).toBe("crew-lvvQXRsfmu");
  });

  it("accepts outline collection sync by URL or collection ID", () => {
    expect(outlineCollectionSyncInputSchema.parse({ url: "https://docs.example.com/collection/redibook-abc123" }).url)
      .toContain("/collection/");
    expect(outlineCollectionSyncInputSchema.parse({ collectionId: "redibook-abc123" }).collectionId).toBe("redibook-abc123");
  });
});

describe("analysis inputs", () => {
  it("preserves the original requirement payload shape", () => {
    expect(createAnalysisInputSchema.parse({
      requirement: "When admin changes payroll period, the system must preserve previous export columns.",
    })).toMatchObject({ requirement: expect.any(String) });
  });

  it("accepts delivery analysis payloads", () => {
    expect(createAnalysisInputSchema.parse({
      mode: "delivery",
      deliveryUrl: "https://docs.example.com/doc/sprint-2-2KehWiBDfH",
      prompt: "Focus on downstream product impact.",
    })).toMatchObject({ mode: "delivery", deliveryUrl: expect.stringContaining("/doc/") });
  });
});
