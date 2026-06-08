import { Inject } from "@nestjs/common";
import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { DeliveryAnalysisInput, EmbeddingProvider, ReasoningProvider } from "@redibook/ai";
import {
  deliveryAnalysisResultSchema,
  impactAnalysisResultSchema,
  validateDeliveryModelEvidence,
  validateModelEvidence,
} from "@redibook/contracts";
import type { Database } from "@redibook/database";
import { withTransaction } from "@redibook/database";
import { observe } from "@redibook/observability";
import { ANALYSIS_QUEUE, ANALYZE_REQUIREMENT_JOB, type AnalysisJob } from "@redibook/queue";
import { hybridRetrieve, type RetrievedChunk } from "@redibook/retrieval";
import type { Job } from "bullmq";
import { DATABASE, EMBEDDING_PROVIDER, REASONING_PROVIDER } from "./tokens.js";

type RunState = {
  requirement: string;
  status: string;
  mode: "requirement" | "delivery";
  source_group_id: string | null;
  delivery_url: string | null;
  delivery_document_id: string | null;
  delivery_title: string | null;
  input_prompt: string | null;
};

type SourceDeliveryDocumentRow = {
  id: string;
  title: string;
  markdown: string;
  metadata: unknown;
};

type OutlineDocumentTreeNode = {
  id: string;
  title?: string;
  url?: string;
  children: OutlineDocumentTreeNode[];
};

type OutlineLeafDocument = {
  id: string;
  title?: string;
  url?: string;
  ancestry: Array<{ id: string; title?: string; url?: string }>;
};

type DeliveryInputDocument = {
  sourceDocumentId?: string;
  outlineDocumentId?: string;
  title: string;
  markdown: string;
  outlinePath: string[];
  url: string | null;
};

@Processor(ANALYSIS_QUEUE, { concurrency: 2 })
export class AnalysisProcessor extends WorkerHost {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(REASONING_PROVIDER) private readonly reasoning: ReasoningProvider,
  ) {
    super();
  }

  async process(job: Job<AnalysisJob>): Promise<void> {
    if (job.name !== ANALYZE_REQUIREMENT_JOB) throw new Error(`Unsupported analysis job ${job.name}`);
    const runResult = await this.database.query<RunState>(`
      SELECT requirement, status, mode, source_group_id, delivery_url, delivery_document_id, delivery_title, input_prompt
      FROM requirement_analysis_runs
      WHERE id = $1
    `, [job.data.runId]);
    const run = runResult.rows[0];
    if (!run || run.status === "completed") return;

    await this.database.query(`
      UPDATE requirement_analysis_runs
      SET status = 'retrieving', started_at = coalesce(started_at, now()), error = NULL, updated_at = now()
      WHERE id = $1
    `, [job.data.runId]);

    if (run.mode === "delivery") {
      await this.processDeliveryRun(job, run);
      return;
    }

    await this.processRequirementRun(job, run);
  }

  private async processRequirementRun(job: Job<AnalysisJob>, run: RunState) {
    const [queryEmbedding] = await observe("embed-requirement", "embedding", {
      runId: job.data.runId,
      mode: run.mode,
      provider: this.embeddings.name,
      model: this.embeddings.model,
    }, () => this.embeddings.embed([run.requirement]));
    const evidence = await observe("hybrid-retrieval", "retriever", {
      runId: job.data.runId,
      mode: run.mode,
      lexicalWeight: 0.45,
      semanticWeight: 0.55,
    }, () => hybridRetrieve(this.database, run.requirement, queryEmbedding!));

    await this.persistEvidence(job.data.runId, evidence);

    const modelResult = await observe("analyze-requirement", "generation", {
      runId: job.data.runId,
      mode: run.mode,
      provider: this.reasoning.name,
      model: this.reasoning.model,
      evidenceCount: evidence.length,
    }, () => this.reasoning.analyze(run.requirement, evidence));
    const validated = validateModelEvidence(modelResult, evidence.map((item) => item.chunkId));
    const referenced = new Set(validated.evidenceChunkIds);
    const result = impactAnalysisResultSchema.parse({
      summary: validated.summary,
      affectedKnowledge: validated.affectedKnowledge,
      possibleConflicts: validated.possibleConflicts,
      missingQuestions: validated.missingQuestions,
      suggestedTests: validated.suggestedTests,
      evidence: evidence
        .filter((item) => referenced.has(item.chunkId))
        .map((item) => ({
          chunkId: item.chunkId,
          title: item.title,
          section: item.section,
          excerpt: excerpt(item.content),
        })),
    });
    await this.completeRun(job.data.runId, result);
  }

  private async processDeliveryRun(job: Job<AnalysisJob>, run: RunState) {
    if (run.delivery_document_id) {
      await this.processOutlineDeliveryRun(job, run);
      return;
    }

    await this.processLegacySourceGroupDeliveryRun(job, run);
  }

  private async processOutlineDeliveryRun(job: Job<AnalysisJob>, run: RunState) {
    if (!run.delivery_document_id) throw new Error("Delivery analysis is missing an Outline document");

    const rootDocument = await this.fetchOutlineDocument(run.delivery_document_id);
    const tree = await this.fetchOutlineDocumentTree(run.delivery_document_id);
    const leaves = collectOutlineLeafDocuments(tree.children);
    const leafDocuments = leaves.length ? leaves : [{
      id: rootDocument.id,
      title: rootDocument.title,
      url: rootDocument.url,
      ancestry: [],
    }];

    const fetchedDocuments = await Promise.all(leafDocuments.map(async (leaf) => {
      const document = leaf.id === rootDocument.id ? rootDocument : await this.fetchOutlineDocument(leaf.id);
      return {
        outlineDocumentId: document.id,
        title: document.title,
        markdown: document.text,
        outlinePath: [
          rootDocument.title,
          ...leaf.ancestry.map((node) => node.title).filter((title): title is string => Boolean(title)),
          document.title,
        ].filter((value, index, values) => index === 0 || value !== values[index - 1]),
        url: document.url ?? leaf.url ?? null,
      };
    }));

    await this.database.query(`
      UPDATE requirement_analysis_runs
      SET delivery_title = $2, delivery_url = coalesce($3, delivery_url), updated_at = now()
      WHERE id = $1
    `, [job.data.runId, rootDocument.title, rootDocument.url ?? run.delivery_url]);

    const excludedDocumentIds = await this.resolveIndexedSourceIdsForOutlineDocuments(
      fetchedDocuments.map((document) => document.outlineDocumentId),
    );
    await this.analyzeDeliveryDocuments(job, {
      groupName: rootDocument.title,
      prompt: run.input_prompt,
      documents: fetchedDocuments,
      excludedDocumentIds,
    });
  }

  private async processLegacySourceGroupDeliveryRun(job: Job<AnalysisJob>, run: RunState) {
    if (!run.source_group_id) throw new Error("Delivery analysis is missing a source group");

    const groupResult = await this.database.query<{ name: string }>(`
      SELECT name
      FROM source_groups
      WHERE id = $1
    `, [run.source_group_id]);
    const group = groupResult.rows[0];
    if (!group) throw new Error("Source group no longer exists");

    const documentResult = await this.database.query<SourceDeliveryDocumentRow>(`
      SELECT sd.id, sd.title, sd.markdown, sd.metadata
      FROM source_document_groups sdg
      JOIN source_documents sd ON sd.id = sdg.document_id
      WHERE sdg.group_id = $1
      ORDER BY sd.title ASC
    `, [run.source_group_id]);
    if (!documentResult.rows.length) throw new Error("Delivery source group has no synced documents");

    const inputDocuments = documentResult.rows.map((row) => {
      const metadata = parseSourceDocumentMetadata(row.metadata);
      return {
        sourceDocumentId: row.id,
        title: row.title,
        markdown: row.markdown,
        outlinePath: metadata.outlinePath ?? [row.title],
        excerpt: excerpt(row.markdown, 320),
      };
    });

    await this.analyzeDeliveryDocuments(job, {
      groupName: group.name,
      prompt: run.input_prompt,
      documents: inputDocuments.map((item) => ({
        sourceDocumentId: item.sourceDocumentId,
        title: item.title,
        markdown: item.markdown,
        outlinePath: item.outlinePath,
        url: null,
      })),
      excludedDocumentIds: inputDocuments.map((item) => item.sourceDocumentId),
    });
  }

  private async analyzeDeliveryDocuments(
    job: Job<AnalysisJob>,
    input: {
      groupName: string;
      prompt: string | null;
      documents: DeliveryInputDocument[];
      excludedDocumentIds: string[];
    },
  ) {
    await this.markAnalyzing(job.data.runId);

    const aggregatedEvidence = new Map<string, RetrievedChunk>();
    const documents = [];

    for (const document of input.documents) {
      const docInput = {
        ...document,
        excerpt: excerpt(document.markdown, 320),
      };
      const retrievalPrompt = buildDeliveryQuery(input.groupName, docInput, input.prompt);

      const [queryEmbedding] = await observe("embed-delivery", "embedding", {
        runId: job.data.runId,
        mode: "delivery",
        provider: this.embeddings.name,
        model: this.embeddings.model,
        documentTitle: document.title,
      }, () => this.embeddings.embed([retrievalPrompt]));
      const evidence = await observe("hybrid-retrieval", "retriever", {
        runId: job.data.runId,
        mode: "delivery",
        lexicalWeight: 0.45,
        semanticWeight: 0.55,
        documentTitle: document.title,
        excludedDocuments: input.excludedDocumentIds.length,
      }, () => hybridRetrieve(this.database, retrievalPrompt, queryEmbedding!, {
        excludedDocumentIds: input.excludedDocumentIds,
      }));
      evidence.forEach((item) => {
        if (!aggregatedEvidence.has(item.chunkId)) aggregatedEvidence.set(item.chunkId, item);
      });

      const modelInput: DeliveryAnalysisInput = {
        groupName: input.groupName,
        prompt: input.prompt,
        document: {
          title: docInput.title,
          outlinePath: docInput.outlinePath,
          excerpt: docInput.excerpt,
        },
      };
      const modelResult = await observe("analyze-delivery", "generation", {
        runId: job.data.runId,
        mode: "delivery",
        provider: this.reasoning.name,
        model: this.reasoning.model,
        evidenceCount: evidence.length,
        documentTitle: document.title,
      }, () => this.reasoning.analyzeDelivery(modelInput, evidence));
      const validated = validateDeliveryModelEvidence(modelResult, evidence.map((item) => item.chunkId));
      const referenced = new Set(validated.evidenceChunkIds);
      documents.push({
        inputDocument: {
          sourceDocumentId: docInput.sourceDocumentId,
          outlineDocumentId: docInput.outlineDocumentId,
          title: docInput.title,
          outlinePath: docInput.outlinePath,
        },
        summary: validated.summary,
        impactedAreas: validated.impactedAreas,
        possibleConflicts: validated.possibleConflicts,
        dependencies: validated.dependencies,
        missingClarifications: validated.missingClarifications,
        evidence: evidence
          .filter((item) => referenced.has(item.chunkId))
          .map((item) => ({
            chunkId: item.chunkId,
            title: item.title,
            section: item.section,
            excerpt: excerpt(item.content),
          })),
      });
    }

    await this.persistEvidence(job.data.runId, [...aggregatedEvidence.values()], false);

    const result = deliveryAnalysisResultSchema.parse({
      documents,
    });
    await this.completeRun(job.data.runId, result);
  }

  private async resolveIndexedSourceIdsForOutlineDocuments(outlineDocumentIds: string[]) {
    if (!outlineDocumentIds.length) return [];
    const result = await this.database.query<{ id: string }>(`
      SELECT id
      FROM source_documents
      WHERE outline_document_id = ANY($1::text[])
    `, [outlineDocumentIds]);
    return result.rows.map((row) => row.id);
  }

  private async fetchOutlineDocument(documentId: string) {
    return parseOutlineDocumentPayload(await this.callOutline("documents.info", { id: documentId }));
  }

  private async fetchOutlineDocumentTree(documentId: string) {
    return parseOutlineDocumentTreePayload(await this.callOutline("documents.documents", { id: documentId }));
  }

  private async callOutline(method: string, body: Record<string, string>) {
    const apiKey = process.env.OUTLINE_API_KEY;
    if (!apiKey) throw new Error("OUTLINE_API_KEY is required for Outline delivery analysis");
    const baseUrl = (process.env.OUTLINE_BASE_URL ?? "https://app.getoutline.com").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Outline ${method} failed with ${response.status}`);
    return response.json();
  }

  private async persistEvidence(runId: string, evidence: RetrievedChunk[], updateStatus = true) {
    await withTransaction(this.database, async (client) => {
      await client.query("DELETE FROM retrieved_evidence WHERE run_id = $1", [runId]);
      for (const [index, item] of evidence.entries()) {
        await client.query(`
          INSERT INTO retrieved_evidence (
            run_id, chunk_id, rank, lexical_score, semantic_score, combined_score,
            title_snapshot, section_snapshot, excerpt_snapshot
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          runId,
          item.chunkId,
          index + 1,
          item.lexicalScore,
          item.semanticScore,
          item.combinedScore,
          item.title,
          item.section,
          excerpt(item.content),
        ]);
      }
      if (updateStatus) {
        await client.query(
          "UPDATE requirement_analysis_runs SET status = 'analyzing', updated_at = now() WHERE id = $1",
          [runId],
        );
      }
    });
  }

  private async markAnalyzing(runId: string) {
    await this.database.query(
      "UPDATE requirement_analysis_runs SET status = 'analyzing', updated_at = now() WHERE id = $1",
      [runId],
    );
  }

  private async completeRun(runId: string, result: unknown) {
    await this.database.query(`
      UPDATE requirement_analysis_runs
      SET status = 'completed', impact_result = $2::jsonb, provider = $3, model = $4,
        error = NULL, completed_at = now(), updated_at = now()
      WHERE id = $1
    `, [runId, JSON.stringify(result), this.reasoning.name, this.reasoning.model]);
  }

  @OnWorkerEvent("failed")
  async failed(job: Job<AnalysisJob> | undefined, error: Error): Promise<void> {
    if (!job) return;
    await this.database.query(`
      UPDATE requirement_analysis_runs
      SET status = 'failed', error = $2, updated_at = now()
      WHERE id = $1
    `, [job.data.runId, error.message]);
  }
}

function buildDeliveryQuery(
  groupName: string,
  document: { title: string; outlinePath: string[]; excerpt: string },
  prompt: string | null,
) {
  return [
    `Delivery bundle: ${groupName}`,
    `Delivery document: ${document.outlinePath.join(" / ")}`,
    prompt ? `Question: ${prompt}` : "Question: Identify impacted product knowledge, dependencies, and conflicts outside this delivery bundle.",
    document.excerpt,
  ].join("\n\n");
}

function excerpt(content: string, maxLength = 420): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
}

function parseSourceDocumentMetadata(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const candidate = value as { outlinePath?: unknown };
  return {
    outlinePath: Array.isArray(candidate.outlinePath)
      ? candidate.outlinePath.filter((item): item is string => typeof item === "string")
      : undefined,
  };
}

function parseOutlineDocumentPayload(value: unknown) {
  const data = getRecord(getRecord(value).data);
  const id = data.id;
  const title = data.title;
  const text = data.text;
  if (typeof id !== "string" || typeof title !== "string" || typeof text !== "string") {
    throw new Error("Outline documents.info returned an invalid document payload");
  }
  return {
    id,
    title,
    text,
    url: typeof data.url === "string" ? data.url : undefined,
  };
}

function parseOutlineDocumentTreePayload(value: unknown): OutlineDocumentTreeNode {
  return parseOutlineDocumentTreeNode(getRecord(getRecord(value).data));
}

function parseOutlineDocumentTreeNode(value: unknown): OutlineDocumentTreeNode {
  const record = getRecord(value);
  if (typeof record.id !== "string") throw new Error("Outline documents.documents returned an invalid tree payload");
  const children = Array.isArray(record.children)
    ? record.children.map(parseOutlineDocumentTreeNode)
    : [];
  return {
    id: record.id,
    title: typeof record.title === "string" ? record.title : undefined,
    url: typeof record.url === "string" ? record.url : undefined,
    children,
  };
}

function getRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("Expected an object payload");
  return value as Record<string, unknown>;
}

function collectOutlineLeafDocuments(
  nodes: OutlineDocumentTreeNode[],
  ancestry: OutlineLeafDocument["ancestry"] = [],
): OutlineLeafDocument[] {
  return nodes.flatMap((node) => {
    if (!node.children.length) {
      return [{
        id: node.id,
        title: node.title,
        url: node.url,
        ancestry,
      }];
    }
    return collectOutlineLeafDocuments(node.children, [...ancestry, {
      id: node.id,
      title: node.title,
      url: node.url,
    }]);
  });
}
