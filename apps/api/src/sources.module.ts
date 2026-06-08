import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  createFeatureGroupInputSchema,
  cursorQuerySchema,
  manualSourceInputSchema,
  outlineCollectionSyncInputSchema,
  outlineSyncInputSchema,
  setSourceFeaturesInputSchema,
  sourceGroupQuerySchema,
  sourceGroupSummarySchema,
  uuidSchema,
  type CreateFeatureGroupInput,
  type ManualSourceInput,
  type OutlineCollectionSyncInput,
  type OutlineSyncInput,
  type SetSourceFeaturesInput,
} from "@redibook/contracts";
import type { Database } from "@redibook/database";
import { withTransaction } from "@redibook/database";
import { hashContent } from "@redibook/ingestion";
import {
  NORMALIZE_DOCUMENT_JOB,
  normalizeJobId,
  type DocumentJob,
} from "@redibook/queue";
import type { Queue } from "bullmq";
import { z } from "zod";
import { DATABASE, DOCUMENTS_QUEUE } from "./infrastructure.module.js";
import { ZodPipe } from "./core.js";

type SourceRow = {
  id: string;
  source_type: "manual" | "outline";
  title: string;
  index_status: string;
  index_error: string | null;
  outline_url: string | null;
  metadata: unknown;
  sprint_groups: unknown;
  feature_groups: unknown;
  created_at: Date;
  updated_at: Date;
};

type SourceGroupRow = {
  id: string;
  group_type: "sprint" | "feature";
  name: string;
  outline_url: string | null;
  created_at: Date;
  updated_at: Date;
};

type OutlineNodeRef = {
  id: string;
  title?: string;
  url?: string;
};

type OutlineLeafDocument = {
  id: string;
  title?: string;
  url?: string;
  ancestry: OutlineNodeRef[];
  orderPath: number[];
};

type OutlineDocumentUpsertResult = {
  id: string;
  indexRevision: number;
  changed: boolean;
  enqueued: boolean;
};

const sourceDocumentMetadataSchema = z.object({
  outlinePath: z.array(z.string()).optional(),
  outlineOrder: z.array(z.number().int().nonnegative()).optional(),
  collectionId: z.string().optional(),
  collectionName: z.string().optional(),
}).passthrough();

const sourceGroupSummaryArraySchema = z.array(sourceGroupSummarySchema);

const outlineDocumentTreeNodeSchema: z.ZodType<OutlineDocumentTreeNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string().optional(),
    url: z.string().optional(),
    children: z.array(outlineDocumentTreeNodeSchema).default([]),
  }),
);

const outlineDocumentPayloadSchema = z.object({
  data: z.object({
    id: z.string(),
    title: z.string(),
    text: z.string(),
    url: z.string().optional(),
  }),
});

const outlineCollectionPayloadSchema = z.object({
  data: z.array(outlineDocumentTreeNodeSchema),
});

const outlineCollectionInfoPayloadSchema = z.object({
  data: z.object({
    id: z.string(),
    name: z.string().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
  }),
});

export type OutlineDocumentTreeNode = {
  id: string;
  title?: string;
  url?: string;
  children: OutlineDocumentTreeNode[];
};

@Injectable()
export class SourcesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENTS_QUEUE) private readonly queue: Queue<DocumentJob>,
  ) {}

  async list(cursor: string | undefined, limit: number) {
    const decoded = cursor ? decodeCursor(cursor) : null;
    const result = await this.database.query<SourceRow>(`
      SELECT
        sd.id,
        sd.source_type,
        sd.title,
        sd.index_status,
        sd.index_error,
        sd.outline_url,
        sd.metadata,
        coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', sg.id,
            'type', sg.group_type,
            'name', sg.name,
            'outlineUrl', sg.outline_url
          ) ORDER BY sg.name)
          FROM source_document_groups sdg
          JOIN source_groups sg ON sg.id = sdg.group_id
          WHERE sdg.document_id = sd.id AND sg.group_type = 'sprint'
        ), '[]'::jsonb) AS sprint_groups,
        coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', sg.id,
            'type', sg.group_type,
            'name', sg.name,
            'outlineUrl', sg.outline_url
          ) ORDER BY sg.name)
          FROM source_document_groups sdg
          JOIN source_groups sg ON sg.id = sdg.group_id
          WHERE sdg.document_id = sd.id AND sg.group_type = 'feature'
        ), '[]'::jsonb) AS feature_groups,
        sd.created_at,
        sd.updated_at
      FROM source_documents sd
      WHERE ($1::timestamptz IS NULL OR (sd.updated_at, sd.id) < ($1::timestamptz, $2::uuid))
      ORDER BY sd.updated_at DESC, sd.id DESC
      LIMIT $3
    `, [decoded?.updatedAt ?? null, decoded?.id ?? null, limit + 1]);
    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    return {
      items: rows.map(mapSource),
      nextCursor: hasMore && rows.at(-1)
        ? encodeCursor(rows.at(-1)!.updated_at, rows.at(-1)!.id)
        : null,
    };
  }

  async listGroups(type: "sprint" | "feature") {
    const result = await this.database.query<SourceGroupRow>(`
      SELECT sg.id, sg.group_type, sg.name, sg.outline_url, sg.created_at, sg.updated_at
      FROM source_groups sg
      WHERE sg.group_type = $1
        AND (
          $1::text = 'feature'
          OR EXISTS (SELECT 1 FROM source_document_groups sdg WHERE sdg.group_id = sg.id)
        )
      ORDER BY sg.name ASC, sg.created_at ASC
    `, [type]);
    return { items: result.rows.map(mapGroup) };
  }

  async createFeatureGroup(input: CreateFeatureGroupInput) {
    const inserted = await this.database.query<{ id: string }>(`
      INSERT INTO source_groups (group_type, name)
      VALUES ('feature', $1)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [input.name]);
    if (inserted.rows[0]?.id) {
      return this.getGroupById(inserted.rows[0].id);
    }

    const existing = await this.database.query<{ id: string }>(`
      SELECT id
      FROM source_groups
      WHERE group_type = 'feature' AND lower(name) = lower($1)
      LIMIT 1
    `, [input.name]);
    if (!existing.rows[0]?.id) throw new Error("Unable to create feature group");
    return this.getGroupById(existing.rows[0].id);
  }

  async createManual(input: ManualSourceInput) {
    const result = await this.database.query<{ id: string; index_revision: string }>(`
      INSERT INTO source_documents (source_type, title, markdown, content_hash)
      VALUES ('manual', $1, $2, $3)
      RETURNING id, index_revision
    `, [input.title, input.markdown, hashContent(input.markdown)]);
    const { id, index_revision } = result.rows[0]!;
    await this.enqueue(id, Number(index_revision));
    return { id, status: "pending" };
  }

  async syncOutline(input: OutlineSyncInput) {
    const documentId = input.documentId ?? extractOutlineDocumentId(input.url!);
    const payload = await this.fetchOutlineDocument(documentId);
    const metadata = { outlinePath: [payload.title] };
    const { id } = await this.upsertOutlineDocument(payload, input.url ?? null, metadata);
    await this.replaceDocumentSprintGroup(id, null);
    return { id, status: "pending" };
  }

  async syncOutlineCollection(input: OutlineCollectionSyncInput) {
    const collectionId = input.collectionId ?? extractOutlineCollectionId(input.url!);
    const collection = await this.fetchOutlineCollectionInfo(collectionId).catch(() => ({
      id: collectionId,
      name: collectionId,
      url: input.url ?? null,
    }));
    const tree = await this.fetchOutlineCollectionTree(collectionId);
    const leafDocuments = dedupeOutlineLeaves(collectOutlineLeafDocuments(tree));
    let indexed = 0;
    let skipped = 0;

    for (const leaf of leafDocuments) {
      const payload = await this.fetchOutlineDocument(leaf.id);
      const outlinePath = [...leaf.ancestry.map((node) => node.title).filter(Boolean), payload.title];
      const { id, enqueued } = await this.upsertOutlineDocument(payload, payload.url ?? null, {
        collectionId,
        collectionName: collection.name,
        outlinePath,
        outlineOrder: leaf.orderPath,
      });
      if (enqueued) indexed += 1;
      else skipped += 1;

      const sprintNode = leaf.ancestry[0];
      const sprintGroupId = sprintNode
        ? await this.upsertSprintGroup(collectionId, sprintNode)
        : null;
      await this.replaceDocumentSprintGroup(id, sprintGroupId);
    }
    const removed = await this.removeStaleCollectionDocuments(collectionId, leafDocuments.map((leaf) => leaf.id));

    return {
      collectionId,
      status: "pending" as const,
      synced: leafDocuments.length,
      indexed,
      skipped,
      removed,
    };
  }

  async setFeatures(id: string, input: SetSourceFeaturesInput) {
    const featureIds = [...new Set(input.featureGroupIds)];
    const existing = await this.database.query<{ id: string }>(
      "SELECT id FROM source_documents WHERE id = $1",
      [id],
    );
    if (!existing.rowCount) throw new NotFoundException({ code: "SOURCE_NOT_FOUND", message: "Source not found" });

    if (featureIds.length) {
      const groups = await this.database.query<{ id: string }>(`
        SELECT id
        FROM source_groups
        WHERE group_type = 'feature' AND id = ANY($1::uuid[])
      `, [featureIds]);
      if (groups.rows.length !== featureIds.length) {
        throw new NotFoundException({ code: "FEATURE_GROUP_NOT_FOUND", message: "One or more feature groups were not found" });
      }
    }

    await withTransaction(this.database, async (client) => {
      await client.query(`
        DELETE FROM source_document_groups
        WHERE document_id = $1
          AND group_id IN (SELECT id FROM source_groups WHERE group_type = 'feature')
      `, [id]);

      for (const featureId of featureIds) {
        await client.query(`
          INSERT INTO source_document_groups (group_id, document_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [featureId, id]);
      }
    });

    return this.getSource(id);
  }

  async reindex(id: string) {
    const result = await this.database.query<{ index_revision: string }>(
      `UPDATE source_documents
       SET index_status = 'pending', index_error = NULL,
         index_revision = index_revision + 1, updated_at = now()
       WHERE id = $1
       RETURNING index_revision`,
      [id],
    );
    if (!result.rowCount) throw new NotFoundException({ code: "SOURCE_NOT_FOUND", message: "Source not found" });
    await this.enqueue(id, Number(result.rows[0]!.index_revision));
    return { id, status: "pending" };
  }

  async reset() {
    await this.queue.drain(true);
    await this.database.query("DELETE FROM source_groups WHERE group_type = 'sprint'");
    const result = await this.database.query<{ id: string }>("DELETE FROM source_documents RETURNING id");
    return {
      status: "deleted" as const,
      deleted: result.rowCount ?? result.rows.length,
    };
  }

  private async getSource(id: string) {
    const result = await this.database.query<SourceRow>(`
      SELECT
        sd.id,
        sd.source_type,
        sd.title,
        sd.index_status,
        sd.index_error,
        sd.outline_url,
        sd.metadata,
        coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', sg.id,
            'type', sg.group_type,
            'name', sg.name,
            'outlineUrl', sg.outline_url
          ) ORDER BY sg.name)
          FROM source_document_groups sdg
          JOIN source_groups sg ON sg.id = sdg.group_id
          WHERE sdg.document_id = sd.id AND sg.group_type = 'sprint'
        ), '[]'::jsonb) AS sprint_groups,
        coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', sg.id,
            'type', sg.group_type,
            'name', sg.name,
            'outlineUrl', sg.outline_url
          ) ORDER BY sg.name)
          FROM source_document_groups sdg
          JOIN source_groups sg ON sg.id = sdg.group_id
          WHERE sdg.document_id = sd.id AND sg.group_type = 'feature'
        ), '[]'::jsonb) AS feature_groups,
        sd.created_at,
        sd.updated_at
      FROM source_documents sd
      WHERE sd.id = $1
    `, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ code: "SOURCE_NOT_FOUND", message: "Source not found" });
    return mapSource(row);
  }

  private async getGroupById(id: string) {
    const result = await this.database.query<SourceGroupRow>(`
      SELECT id, group_type, name, outline_url, created_at, updated_at
      FROM source_groups
      WHERE id = $1
    `, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ code: "SOURCE_GROUP_NOT_FOUND", message: "Source group not found" });
    return mapGroup(row);
  }

  private async enqueue(documentId: string, revision: number) {
    await this.queue.add(NORMALIZE_DOCUMENT_JOB, { documentId }, {
      jobId: normalizeJobId(documentId, revision),
    });
  }

  private async fetchOutlineDocument(documentId: string) {
    return outlineDocumentPayloadSchema.parse(await this.callOutline("documents.info", { id: documentId })).data;
  }

  private async fetchOutlineCollectionTree(collectionId: string) {
    return outlineCollectionPayloadSchema.parse(await this.callOutline("collections.documents", { id: collectionId })).data;
  }

  private async fetchOutlineCollectionInfo(collectionId: string) {
    const payload = outlineCollectionInfoPayloadSchema.parse(await this.callOutline("collections.info", { id: collectionId })).data;
    return {
      id: payload.id,
      name: payload.name ?? payload.title ?? collectionId,
      url: payload.url ?? null,
    };
  }

  private async callOutline(method: string, body: Record<string, string>) {
    const apiKey = process.env.OUTLINE_API_KEY;
    if (!apiKey) throw new Error("OUTLINE_API_KEY is required for Outline sync");
    const baseUrl = (process.env.OUTLINE_BASE_URL ?? "https://app.getoutline.com").replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Outline ${method} failed with ${response.status}`);
    return response.json();
  }

  private async upsertOutlineDocument(
    payload: z.infer<typeof outlineDocumentPayloadSchema>["data"],
    fallbackUrl: string | null,
    metadata: Record<string, unknown>,
  ): Promise<OutlineDocumentUpsertResult> {
    const contentHash = hashContent(payload.text);
    const inserted = await this.database.query<{ id: string; index_revision: string }>(`
      INSERT INTO source_documents (
        source_type, outline_document_id, outline_url, title, markdown, content_hash, metadata, index_status, index_error
      ) VALUES ('outline', $1, $2, $3, $4, $5, $6::jsonb, 'pending', NULL)
      ON CONFLICT (outline_document_id) WHERE outline_document_id IS NOT NULL DO NOTHING
      RETURNING id, index_revision
    `, [payload.id, payload.url ?? fallbackUrl, payload.title, payload.text, contentHash, JSON.stringify(metadata)]);
    if (inserted.rows[0]) {
      const insertedRow = inserted.rows[0];
      const indexRevision = Number(insertedRow.index_revision);
      await this.enqueue(insertedRow.id, indexRevision);
      return {
        id: insertedRow.id,
        indexRevision,
        changed: true,
        enqueued: true,
      };
    }

    const existing = await this.database.query<{
      id: string;
      content_hash: string;
      index_revision: string;
      index_status: string;
    }>(`
      SELECT id, content_hash, index_revision, index_status
      FROM source_documents
      WHERE outline_document_id = $1
    `, [payload.id]);

    const row = existing.rows[0];
    if (!row) throw new Error("Unable to upsert Outline document");

    const changed = row.content_hash !== contentHash;
    const shouldEnqueue = shouldIndexOutlineDocument(row.content_hash, contentHash, row.index_status);
    const updated = await this.database.query<{ id: string; index_revision: string }>(
      shouldEnqueue
        ? `
          UPDATE source_documents
          SET outline_url = $2, title = $3,
            markdown = $4, content_hash = $5, metadata = $6::jsonb,
            index_status = 'pending', index_error = NULL,
            index_revision = index_revision + 1, updated_at = now()
          WHERE id = $1
          RETURNING id, index_revision
        `
        : `
          UPDATE source_documents
          SET outline_url = $2, title = $3, metadata = $6::jsonb, updated_at = now()
          WHERE id = $1
          RETURNING id, index_revision
        `,
      [row.id, payload.url ?? fallbackUrl, payload.title, payload.text, contentHash, JSON.stringify(metadata)],
    );
    const updatedRow = updated.rows[0]!;
    const indexRevision = Number(updatedRow.index_revision);
    if (shouldEnqueue) await this.enqueue(updatedRow.id, indexRevision);
    return {
      id: updatedRow.id,
      indexRevision,
      changed,
      enqueued: shouldEnqueue,
    };
  }

  private async removeStaleCollectionDocuments(collectionId: string, activeOutlineDocumentIds: string[]) {
    const result = await this.database.query<{ id: string }>(`
      DELETE FROM source_documents
      WHERE source_type = 'outline'
        AND metadata->>'collectionId' = $1
        AND outline_document_id IS NOT NULL
        AND NOT (outline_document_id = ANY($2::text[]))
      RETURNING id
    `, [collectionId, activeOutlineDocumentIds]);

    await this.database.query(`
      DELETE FROM source_groups sg
      WHERE sg.group_type = 'sprint'
        AND sg.outline_collection_id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM source_document_groups sdg
          WHERE sdg.group_id = sg.id
        )
    `, [collectionId]);

    return result.rowCount ?? result.rows.length;
  }

  private async upsertSprintGroup(collectionId: string, node: OutlineNodeRef) {
    const name = node.title?.trim() || node.id;
    const result = await this.database.query<{ id: string }>(`
      INSERT INTO source_groups (
        group_type, name, outline_collection_id, outline_node_id, outline_url, metadata
      ) VALUES ('sprint', $1, $2, $3, $4, '{}'::jsonb)
      ON CONFLICT (group_type, outline_collection_id, outline_node_id)
      WHERE group_type = 'sprint'
      DO UPDATE SET name = excluded.name, outline_url = excluded.outline_url, updated_at = now()
      RETURNING id
    `, [name, collectionId, node.id, node.url ?? null]);
    return result.rows[0]!.id;
  }

  private async replaceDocumentSprintGroup(documentId: string, sprintGroupId: string | null) {
    await withTransaction(this.database, async (client) => {
      await client.query(`
        DELETE FROM source_document_groups
        WHERE document_id = $1
          AND group_id IN (SELECT id FROM source_groups WHERE group_type = 'sprint')
      `, [documentId]);

      if (sprintGroupId) {
        await client.query(`
          INSERT INTO source_document_groups (group_id, document_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [sprintGroupId, documentId]);
      }
    });
  }
}

@Controller("sources")
export class SourcesController {
  constructor(@Inject(SourcesService) private readonly sources: SourcesService) {}

  @Get()
  list(@Query(new ZodPipe(cursorQuerySchema)) query: z.infer<typeof cursorQuerySchema>) {
    return this.sources.list(query.cursor, query.limit);
  }

  @Post("manual")
  createManual(@Body(new ZodPipe(manualSourceInputSchema)) input: ManualSourceInput) {
    return this.sources.createManual(input);
  }

  @Post("outline/sync")
  syncOutline(@Body(new ZodPipe(outlineSyncInputSchema)) input: OutlineSyncInput) {
    return this.sources.syncOutline(input);
  }

  @Post("outline/collection/sync")
  syncOutlineCollection(@Body(new ZodPipe(outlineCollectionSyncInputSchema)) input: OutlineCollectionSyncInput) {
    return this.sources.syncOutlineCollection(input);
  }

  @Patch(":id/features")
  setFeatures(
    @Param("id", new ZodPipe(uuidSchema)) id: string,
    @Body(new ZodPipe(setSourceFeaturesInputSchema)) input: SetSourceFeaturesInput,
  ) {
    return this.sources.setFeatures(id, input);
  }

  @Post(":id/index")
  @HttpCode(202)
  reindex(@Param("id", new ZodPipe(uuidSchema)) id: string) {
    return this.sources.reindex(id);
  }

  @Post("reset")
  reset() {
    return this.sources.reset();
  }
}

@Controller("source-groups")
export class SourceGroupsController {
  constructor(@Inject(SourcesService) private readonly sources: SourcesService) {}

  @Get()
  list(@Query(new ZodPipe(sourceGroupQuerySchema)) query: z.infer<typeof sourceGroupQuerySchema>) {
    return this.sources.listGroups(query.type);
  }

  @Post()
  createFeature(@Body(new ZodPipe(createFeatureGroupInputSchema)) input: CreateFeatureGroupInput) {
    return this.sources.createFeatureGroup(input);
  }
}

@Module({
  controllers: [SourcesController, SourceGroupsController],
  providers: [SourcesService],
})
export class SourcesModule {}

function mapSource(row: SourceRow) {
  const metadata = sourceDocumentMetadataSchema.parse(row.metadata ?? {});
  return {
    id: row.id,
    sourceType: row.source_type,
    title: row.title,
    indexStatus: row.index_status,
    indexError: row.index_error,
    outlineUrl: row.outline_url,
    outlinePath: metadata.outlinePath ?? [],
    outlineOrder: metadata.outlineOrder ?? [],
    collectionName: metadata.collectionName ?? metadata.collectionId ?? null,
    sprintGroups: sourceGroupSummaryArraySchema.parse(row.sprint_groups ?? []),
    featureGroups: sourceGroupSummaryArraySchema.parse(row.feature_groups ?? []),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapGroup(row: SourceGroupRow) {
  return {
    id: row.id,
    type: row.group_type,
    name: row.name,
    outlineUrl: row.outline_url,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt: updatedAt.toISOString(), id })).toString("base64url");
}

function decodeCursor(cursor: string): { updatedAt: string; id: string } {
  try {
    return z.object({ updatedAt: z.string().datetime(), id: z.string().uuid() })
      .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new Error("Invalid pagination cursor");
  }
}

export function flattenOutlineDocumentTree(nodes: OutlineDocumentTreeNode[]): string[] {
  return collectOutlineLeafDocuments(nodes).map((node) => node.id);
}

export function collectOutlineLeafDocuments(
  nodes: OutlineDocumentTreeNode[],
  ancestry: OutlineNodeRef[] = [],
  orderPath: number[] = [],
): OutlineLeafDocument[] {
  return nodes.flatMap((node, index) => {
    const nextOrderPath = [...orderPath, index];
    if (!node.children.length) {
      return [{
        id: node.id,
        title: node.title,
        url: node.url,
        ancestry,
        orderPath: nextOrderPath,
      }];
    }
    const nextAncestry = [...ancestry, { id: node.id, title: node.title, url: node.url }];
    return collectOutlineLeafDocuments(node.children, nextAncestry, nextOrderPath);
  });
}

function dedupeOutlineLeaves(leaves: OutlineLeafDocument[]) {
  const unique = new Map<string, OutlineLeafDocument>();
  for (const leaf of leaves) unique.set(leaf.id, leaf);
  return [...unique.values()];
}

export function extractOutlineDocumentId(url: string): string {
  const lastSegment = new URL(url).pathname.split("/").filter(Boolean).at(-1);
  if (!lastSegment) throw new Error("Unable to extract Outline document ID from URL");
  return lastSegment;
}

export function extractOutlineCollectionId(url: string): string {
  const lastSegment = new URL(url).pathname.split("/").filter(Boolean).at(-1);
  if (!lastSegment) throw new Error("Unable to extract Outline collection ID from URL");
  return lastSegment;
}

export function shouldIndexOutlineDocument(currentContentHash: string, nextContentHash: string, indexStatus: string) {
  return currentContentHash !== nextContentHash || indexStatus === "failed";
}
