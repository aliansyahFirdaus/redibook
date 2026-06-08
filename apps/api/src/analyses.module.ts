import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import {
  createAnalysisInputSchema,
  deliveryAnalysisResultSchema,
  impactAnalysisResultSchema,
  qualityResultSchema,
  sourceGroupSummarySchema,
  uuidSchema,
  type CreateAnalysisInput,
} from "@redibook/contracts";
import { checkRequirementQuality } from "@redibook/ai";
import type { Database } from "@redibook/database";
import { ANALYZE_REQUIREMENT_JOB, analysisJobId, type AnalysisJob } from "@redibook/queue";
import type { Queue } from "bullmq";
import { z } from "zod";
import { DATABASE, ANALYSES_QUEUE } from "./infrastructure.module.js";
import { ZodPipe } from "./core.js";

type RunRow = {
  id: string;
  requirement: string;
  status: string;
  mode: "requirement" | "delivery";
  source_group_id: string | null;
  source_group_name: string | null;
  source_group_type: "sprint" | "feature" | null;
  source_group_outline_url: string | null;
  delivery_url: string | null;
  delivery_document_id: string | null;
  delivery_title: string | null;
  input_prompt: string | null;
  quality_result: unknown;
  impact_result: unknown;
  provider: string | null;
  model: string | null;
  error: string | null;
  created_at: Date;
  completed_at: Date | null;
};

const outlineDocumentPayloadSchema = z.object({
  data: z.object({
    id: z.string(),
    title: z.string(),
    text: z.string(),
    url: z.string().optional(),
  }),
});

@Injectable()
export class AnalysesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ANALYSES_QUEUE) private readonly queue: Queue<AnalysisJob>,
  ) {}

  async create(input: CreateAnalysisInput) {
    if (input.mode === "delivery") {
      const deliveryDocumentId = extractOutlineDocumentId(input.deliveryUrl);
      const deliveryDocument = await this.fetchOutlineDocument(deliveryDocumentId);

      const quality = qualityResultSchema.parse({
        score: 100,
        issues: [],
        missingElements: [],
      });
      const requirement = input.prompt?.trim() || `Delivery analysis for ${deliveryDocument.title}`;
      const result = await this.database.query<{ id: string }>(`
        INSERT INTO requirement_analysis_runs (
          requirement, status, mode, delivery_url, delivery_document_id, delivery_title, input_prompt, quality_result
        )
        VALUES ($1, 'queued', 'delivery', $2, $3, $4, $5, $6::jsonb)
        RETURNING id
      `, [
        requirement,
        deliveryDocument.url ?? input.deliveryUrl,
        deliveryDocument.id || deliveryDocumentId,
        deliveryDocument.title,
        input.prompt?.trim() ?? null,
        JSON.stringify(quality),
      ]);
      const id = result.rows[0]!.id;
      await this.queue.add(ANALYZE_REQUIREMENT_JOB, { runId: id }, { jobId: analysisJobId(id) });
      return {
        id,
        status: "queued" as const,
        quality,
        mode: "delivery" as const,
        sourceGroup: null,
        deliveryReference: {
          url: deliveryDocument.url ?? input.deliveryUrl,
          documentId: deliveryDocument.id || deliveryDocumentId,
          title: deliveryDocument.title,
        },
      };
    }

    const quality = checkRequirementQuality(input.requirement);
    const result = await this.database.query<{ id: string }>(`
      INSERT INTO requirement_analysis_runs (requirement, quality_result)
      VALUES ($1, $2::jsonb)
      RETURNING id
    `, [input.requirement, JSON.stringify(quality)]);
    const id = result.rows[0]!.id;
    await this.queue.add(ANALYZE_REQUIREMENT_JOB, { runId: id }, { jobId: analysisJobId(id) });
    return { id, status: "queued", quality, mode: "requirement" as const };
  }

  async list() {
    const result = await this.database.query<RunRow>(`
      SELECT
        rar.id,
        rar.requirement,
        rar.status,
        rar.mode,
        rar.source_group_id,
        sg.name AS source_group_name,
        sg.group_type AS source_group_type,
        sg.outline_url AS source_group_outline_url,
        rar.delivery_url,
        rar.delivery_document_id,
        rar.delivery_title,
        rar.input_prompt,
        rar.quality_result,
        rar.impact_result,
        rar.provider,
        rar.model,
        rar.error,
        rar.created_at,
        rar.completed_at
      FROM requirement_analysis_runs rar
      LEFT JOIN source_groups sg ON sg.id = rar.source_group_id
      ORDER BY rar.created_at DESC
      LIMIT 25
    `);
    return { items: result.rows.map(mapRun) };
  }

  async get(id: string) {
    const result = await this.database.query<RunRow>(`
      SELECT
        rar.id,
        rar.requirement,
        rar.status,
        rar.mode,
        rar.source_group_id,
        sg.name AS source_group_name,
        sg.group_type AS source_group_type,
        sg.outline_url AS source_group_outline_url,
        rar.delivery_url,
        rar.delivery_document_id,
        rar.delivery_title,
        rar.input_prompt,
        rar.quality_result,
        rar.impact_result,
        rar.provider,
        rar.model,
        rar.error,
        rar.created_at,
        rar.completed_at
      FROM requirement_analysis_runs rar
      LEFT JOIN source_groups sg ON sg.id = rar.source_group_id
      WHERE rar.id = $1
    `, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ code: "ANALYSIS_NOT_FOUND", message: "Analysis not found" });
    return mapRun(row);
  }

  private async fetchOutlineDocument(documentId: string) {
    return outlineDocumentPayloadSchema.parse(await this.callOutline("documents.info", { id: documentId })).data;
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
}

@Controller("analyses")
export class AnalysesController {
  constructor(@Inject(AnalysesService) private readonly analyses: AnalysesService) {}

  @Get()
  list() {
    return this.analyses.list();
  }

  @Post()
  @HttpCode(202)
  create(@Body(new ZodPipe(createAnalysisInputSchema)) input: CreateAnalysisInput) {
    return this.analyses.create(input);
  }

  @Get(":id")
  get(@Param("id", new ZodPipe(uuidSchema)) id: string) {
    return this.analyses.get(id);
  }
}

@Module({ controllers: [AnalysesController], providers: [AnalysesService] })
export class AnalysesModule {}

function mapRun(row: RunRow) {
  return {
    id: row.id,
    requirement: row.requirement,
    status: row.status,
    mode: row.mode,
    sourceGroup: row.source_group_id && row.source_group_name && row.source_group_type
      ? sourceGroupSummarySchema.parse({
        id: row.source_group_id,
        type: row.source_group_type,
        name: row.source_group_name,
        outlineUrl: row.source_group_outline_url,
      })
      : null,
    deliveryReference: row.delivery_document_id
      ? {
        url: row.delivery_url,
        documentId: row.delivery_document_id,
        title: row.delivery_title ?? row.requirement,
      }
      : null,
    inputPrompt: row.input_prompt,
    quality: qualityResultSchema.parse(row.quality_result),
    result: row.impact_result
      ? row.mode === "delivery"
        ? deliveryAnalysisResultSchema.parse(row.impact_result)
        : impactAnalysisResultSchema.parse(row.impact_result)
      : null,
    provider: row.provider,
    model: row.model,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

function extractOutlineDocumentId(url: string): string {
  const parsed = new URL(url);
  if (!parsed.pathname.split("/").filter(Boolean).includes("doc")) {
    throw new BadRequestException({ code: "INVALID_DELIVERY_URL", message: "Delivery URL must be an Outline document URL" });
  }
  const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1);
  if (!lastSegment) {
    throw new BadRequestException({ code: "INVALID_DELIVERY_URL", message: "Unable to extract Outline document ID from URL" });
  }
  return lastSegment;
}
