import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const sourceStatusSchema = z.enum(["pending", "normalizing", "embedding", "ready", "failed"]);
export const analysisStatusSchema = z.enum(["queued", "retrieving", "analyzing", "completed", "failed"]);
export const sourceGroupTypeSchema = z.enum(["sprint", "feature"]);
export const analysisModeSchema = z.enum(["requirement", "delivery"]);

export const manualSourceInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  markdown: z.string().trim().min(1).max(1_000_000),
});

export const outlineSyncInputSchema = z.object({
  documentId: z.string().trim().min(1).optional(),
  url: z.string().url().optional(),
}).refine((value) => Boolean(value.documentId || value.url), {
  message: "documentId or url is required",
});

export const outlineCollectionSyncInputSchema = z.object({
  collectionId: z.string().trim().min(1).optional(),
  url: z.string().url().optional(),
}).refine((value) => Boolean(value.collectionId || value.url), {
  message: "collectionId or url is required",
});

const requirementAnalysisInputSchema = z.object({
  mode: z.literal("requirement").optional(),
  requirement: z.string().trim().min(10).max(20_000),
});

const deliveryAnalysisInputSchema = z.object({
  mode: z.literal("delivery"),
  deliveryUrl: z.string().url(),
  prompt: z.string().trim().min(1).max(20_000).optional(),
});

export const createAnalysisInputSchema = z.union([
  requirementAnalysisInputSchema,
  deliveryAnalysisInputSchema,
]);

export const createFeatureGroupInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const setSourceFeaturesInputSchema = z.object({
  featureGroupIds: z.array(uuidSchema).max(50),
});

export const sourceGroupQuerySchema = z.object({
  type: sourceGroupTypeSchema,
});

export const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(250).default(25),
});

export const qualityResultSchema = z.object({
  score: z.number().int().min(0).max(100),
  issues: z.array(z.string()),
  missingElements: z.array(z.enum([
    "actor",
    "behavior",
    "conditions",
    "constraints",
    "acceptanceCriteria",
  ])),
});

export const sourceGroupSummarySchema = z.object({
  id: uuidSchema,
  type: sourceGroupTypeSchema,
  name: z.string().min(1),
  outlineUrl: z.string().nullable(),
});

export const evidenceSchema = z.object({
  chunkId: uuidSchema,
  title: z.string(),
  section: z.string().nullable(),
  excerpt: z.string(),
});

const affectedKnowledgeItemSchema = z.object({
  knowledge: z.string().min(1),
  impact: z.string().min(1),
  evidenceChunkIds: z.array(uuidSchema).min(1),
});

const conflictSchema = z.object({
  conflict: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  evidenceChunkIds: z.array(uuidSchema).min(1),
});

const impactAnalysisShape = {
  summary: z.string().min(1),
  affectedKnowledge: z.array(affectedKnowledgeItemSchema),
  possibleConflicts: z.array(conflictSchema),
  missingQuestions: z.array(z.string().min(1)),
  suggestedTests: z.array(z.string().min(1)),
  evidence: z.array(evidenceSchema),
};

const deliveryInputDocumentSchema = z.object({
  sourceDocumentId: uuidSchema.optional(),
  outlineDocumentId: z.string().min(1).optional(),
  title: z.string().min(1),
  outlinePath: z.array(z.string().min(1)),
}).refine((value) => Boolean(value.sourceDocumentId || value.outlineDocumentId), {
  message: "sourceDocumentId or outlineDocumentId is required",
});

const impactedAreaSchema = z.object({
  area: z.string().min(1),
  impact: z.string().min(1),
  evidenceChunkIds: z.array(uuidSchema).min(1),
});

const dependencySchema = z.object({
  dependency: z.string().min(1),
  rationale: z.string().min(1),
  evidenceChunkIds: z.array(uuidSchema).min(1),
});

const legacyDeliveryAnalysisShape = {
  summary: z.string().min(1),
  inputDocuments: z.array(deliveryInputDocumentSchema).min(1),
  impactedAreas: z.array(impactedAreaSchema),
  possibleConflicts: z.array(conflictSchema),
  dependencies: z.array(dependencySchema),
  missingClarifications: z.array(z.string().min(1)),
  evidence: z.array(evidenceSchema),
};

const deliveryDocumentResultShape = {
  inputDocument: deliveryInputDocumentSchema,
  summary: z.string().min(1),
  impactedAreas: z.array(impactedAreaSchema),
  possibleConflicts: z.array(conflictSchema),
  dependencies: z.array(dependencySchema),
  missingClarifications: z.array(z.string().min(1)),
  evidence: z.array(evidenceSchema),
};

export const impactAnalysisResultSchema = z.object(impactAnalysisShape).strict()
  .superRefine((result, context) => validateEvidenceLists(
    result.evidence,
    [
      ...result.affectedKnowledge.map((item) => item.evidenceChunkIds),
      ...result.possibleConflicts.map((item) => item.evidenceChunkIds),
    ],
    context,
  ));

export const legacyDeliveryAnalysisResultSchema = z.object(legacyDeliveryAnalysisShape).strict()
  .superRefine((result, context) => validateEvidenceLists(
    result.evidence,
    [
      ...result.impactedAreas.map((item) => item.evidenceChunkIds),
      ...result.possibleConflicts.map((item) => item.evidenceChunkIds),
      ...result.dependencies.map((item) => item.evidenceChunkIds),
    ],
    context,
  ));

export const deliveryDocumentResultSchema = z.object(deliveryDocumentResultShape).strict()
  .superRefine((result, context) => validateEvidenceLists(
    result.evidence,
    [
      ...result.impactedAreas.map((item) => item.evidenceChunkIds),
      ...result.possibleConflicts.map((item) => item.evidenceChunkIds),
      ...result.dependencies.map((item) => item.evidenceChunkIds),
    ],
    context,
  ));

export const deliveryAnalysisResultSchema = z.union([
  legacyDeliveryAnalysisResultSchema,
  z.object({
    documents: z.array(deliveryDocumentResultSchema).min(1),
  }).strict(),
]);

export const modelImpactResultSchema = z.object({
  summary: impactAnalysisShape.summary,
  affectedKnowledge: impactAnalysisShape.affectedKnowledge,
  possibleConflicts: impactAnalysisShape.possibleConflicts,
  missingQuestions: impactAnalysisShape.missingQuestions,
  suggestedTests: impactAnalysisShape.suggestedTests,
  evidenceChunkIds: z.array(uuidSchema),
}).strict();

export const modelDeliveryResultSchema = z.object({
  summary: deliveryDocumentResultShape.summary,
  impactedAreas: deliveryDocumentResultShape.impactedAreas,
  possibleConflicts: deliveryDocumentResultShape.possibleConflicts,
  dependencies: deliveryDocumentResultShape.dependencies,
  missingClarifications: deliveryDocumentResultShape.missingClarifications,
  evidenceChunkIds: z.array(uuidSchema),
}).strict();

export type ManualSourceInput = z.infer<typeof manualSourceInputSchema>;
export type OutlineSyncInput = z.infer<typeof outlineSyncInputSchema>;
export type OutlineCollectionSyncInput = z.infer<typeof outlineCollectionSyncInputSchema>;
export type CreateAnalysisInput = z.infer<typeof createAnalysisInputSchema>;
export type CreateFeatureGroupInput = z.infer<typeof createFeatureGroupInputSchema>;
export type SetSourceFeaturesInput = z.infer<typeof setSourceFeaturesInputSchema>;
export type QualityResult = z.infer<typeof qualityResultSchema>;
export type SourceGroupSummary = z.infer<typeof sourceGroupSummarySchema>;
export type ImpactAnalysisResult = z.infer<typeof impactAnalysisResultSchema>;
export type DeliveryAnalysisResult = z.infer<typeof deliveryAnalysisResultSchema>;
export type ModelImpactResult = z.infer<typeof modelImpactResultSchema>;
export type ModelDeliveryResult = z.infer<typeof modelDeliveryResultSchema>;

export function validateModelEvidence(result: ModelImpactResult, retrievedIds: string[]): ModelImpactResult {
  const parsed = modelImpactResultSchema.parse(result);
  validateReferencedEvidence(
    parsed.evidenceChunkIds,
    [
      ...parsed.affectedKnowledge.map((item) => item.evidenceChunkIds),
      ...parsed.possibleConflicts.map((item) => item.evidenceChunkIds),
    ],
    retrievedIds,
  );
  return parsed;
}

export function validateDeliveryModelEvidence(result: ModelDeliveryResult, retrievedIds: string[]): ModelDeliveryResult {
  const parsed = modelDeliveryResultSchema.parse(result);
  validateReferencedEvidence(
    parsed.evidenceChunkIds,
    [
      ...parsed.impactedAreas.map((item) => item.evidenceChunkIds),
      ...parsed.possibleConflicts.map((item) => item.evidenceChunkIds),
      ...parsed.dependencies.map((item) => item.evidenceChunkIds),
    ],
    retrievedIds,
  );
  return parsed;
}

function validateEvidenceLists(
  evidence: Array<z.infer<typeof evidenceSchema>>,
  groupedIds: string[][],
  context: z.RefinementCtx,
) {
  const evidenceIds = evidence.map((item) => item.chunkId);
  const uniqueEvidenceIds = new Set(evidenceIds);
  if (uniqueEvidenceIds.size !== evidenceIds.length) {
    context.addIssue({ code: "custom", message: "Evidence chunk IDs must be unique", path: ["evidence"] });
  }

  groupedIds.forEach((ids, groupIndex) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Claim evidence chunk IDs must be unique",
        path: [groupIndex],
      });
    }
    ids.forEach((id) => {
      if (!uniqueEvidenceIds.has(id)) {
        context.addIssue({
          code: "custom",
          message: `Evidence ${id} is not present in the evidence list`,
          path: [groupIndex],
        });
      }
    });
  });
}

function validateReferencedEvidence(
  evidenceIds: string[],
  referencedGroups: string[][],
  retrievedIds: string[],
) {
  const allowed = new Set(retrievedIds);
  const referenced = [
    ...evidenceIds,
    ...referencedGroups.flat(),
  ];
  const duplicates = evidenceIds.length !== new Set(evidenceIds).size;
  const unsupported = referenced.filter((id) => !allowed.has(id));
  const missingFromEvidence = referenced.filter((id) => !evidenceIds.includes(id));
  if (duplicates || unsupported.length || missingFromEvidence.length) {
    throw new Error("AI output contains duplicate, missing, or un-retrieved evidence IDs");
  }
}
