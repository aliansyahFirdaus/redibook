import { Inject } from "@nestjs/common";
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import type { EmbeddingProvider } from "@redibook/ai";
import type { Database } from "@redibook/database";
import { vectorLiteral, withTransaction } from "@redibook/database";
import { chunkMarkdown } from "@redibook/ingestion";
import { observe } from "@redibook/observability";
import {
  DOCUMENT_QUEUE,
  EMBED_DOCUMENT_JOB,
  NORMALIZE_DOCUMENT_JOB,
  embedJobId,
  type DocumentJob,
} from "@redibook/queue";
import type { Job, Queue } from "bullmq";
import { DATABASE, EMBEDDING_PROVIDER } from "./tokens.js";

@Processor(DOCUMENT_QUEUE, { concurrency: 3 })
export class DocumentProcessor extends WorkerHost {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @InjectQueue(DOCUMENT_QUEUE) private readonly queue: Queue<DocumentJob>,
  ) {
    super();
  }

  async process(job: Job<DocumentJob>): Promise<void> {
    if (job.name === NORMALIZE_DOCUMENT_JOB) return this.normalize(job.data.documentId);
    if (job.name === EMBED_DOCUMENT_JOB) return this.embed(job.data.documentId);
    throw new Error(`Unsupported document job ${job.name}`);
  }

  private async normalize(documentId: string): Promise<void> {
    const document = await this.database.query<{ markdown: string; content_hash: string; index_revision: string }>(
      "SELECT markdown, content_hash, index_revision FROM source_documents WHERE id = $1",
      [documentId],
    );
    const row = document.rows[0];
    if (!row) return;
    await this.database.query(
      "UPDATE source_documents SET index_status = 'normalizing', index_error = NULL, updated_at = now() WHERE id = $1",
      [documentId],
    );
    const chunks = chunkMarkdown(row.markdown);
    if (!chunks.length) throw new Error("Document produced no indexable chunks");

    await withTransaction(this.database, async (client) => {
      await client.query("DELETE FROM retrieved_evidence WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE document_id = $1)", [documentId]);
      await client.query("DELETE FROM knowledge_chunks WHERE document_id = $1", [documentId]);
      for (const chunk of chunks) {
        await client.query(`
          INSERT INTO knowledge_chunks (
            document_id, ordinal, section_path, heading, content, token_count, content_hash
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          documentId,
          chunk.ordinal,
          chunk.sectionPath,
          chunk.heading,
          chunk.content,
          chunk.tokenCount,
          chunk.contentHash,
        ]);
      }
      await client.query(
        "UPDATE source_documents SET index_status = 'embedding', updated_at = now() WHERE id = $1",
        [documentId],
      );
    });
    await this.queue.add(EMBED_DOCUMENT_JOB, { documentId }, {
      jobId: embedJobId(documentId, row.content_hash, Number(row.index_revision)),
    });
  }

  private async embed(documentId: string): Promise<void> {
    const result = await this.database.query<{ id: string; content: string; embedding_model: string | null }>(`
      SELECT id, content, embedding_model
      FROM knowledge_chunks
      WHERE document_id = $1
      ORDER BY ordinal
    `, [documentId]);
    if (!result.rows.length) return;
    if (result.rows.every((row) => row.embedding_model === this.embeddings.model)) {
      await this.markReady(documentId);
      return;
    }
    const vectors = await observe("embed-document", "embedding", {
      documentId,
      provider: this.embeddings.name,
      model: this.embeddings.model,
      chunks: result.rows.length,
    }, () => this.embeddings.embed(result.rows.map((row) => row.content)));
    await withTransaction(this.database, async (client) => {
      for (const [index, row] of result.rows.entries()) {
        await client.query(`
          UPDATE knowledge_chunks
          SET embedding = $2::vector, embedding_model = $3, updated_at = now()
          WHERE id = $1
        `, [row.id, vectorLiteral(vectors[index]!), this.embeddings.model]);
      }
      await client.query(`
        UPDATE source_documents
        SET index_status = 'ready', indexed_at = now(), index_error = NULL, updated_at = now()
        WHERE id = $1
      `, [documentId]);
    });
  }

  private async markReady(documentId: string) {
    await this.database.query(`
      UPDATE source_documents
      SET index_status = 'ready', indexed_at = coalesce(indexed_at, now()), index_error = NULL, updated_at = now()
      WHERE id = $1
    `, [documentId]);
  }

  @OnWorkerEvent("failed")
  async failed(job: Job<DocumentJob> | undefined, error: Error): Promise<void> {
    if (!job) return;
    await this.database.query(`
      UPDATE source_documents
      SET index_status = 'failed', index_error = $2, updated_at = now()
      WHERE id = $1
    `, [job.data.documentId, error.message]);
  }
}
