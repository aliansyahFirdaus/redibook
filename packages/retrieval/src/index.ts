import type { Database } from "@redibook/database";
import { vectorLiteral } from "@redibook/database";

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  title: string;
  section: string | null;
  content: string;
  lexicalScore: number;
  semanticScore: number;
  combinedScore: number;
};

export type RetrievalOptions = {
  excludedDocumentIds?: string[];
};

export function combineScores(lexical: number, semantic: number): number {
  return 0.45 * lexical + 0.55 * semantic;
}

export async function hybridRetrieve(
  database: Database,
  requirement: string,
  embedding: number[],
  options: RetrievalOptions = {},
): Promise<RetrievedChunk[]> {
  const excludedDocumentIds = options.excludedDocumentIds ?? [];
  const result = await database.query<{
    chunk_id: string;
    document_id: string;
    title: string;
    section: string | null;
    content: string;
    lexical_score: number;
    semantic_score: number;
    combined_score: number;
  }>(`
    WITH query AS (
      SELECT websearch_to_tsquery('english', $1) AS tsq, $2::vector AS embedding
    ),
    lexical AS (
      SELECT kc.id, ts_rank_cd(kc.search_vector, query.tsq) AS score
      FROM knowledge_chunks kc, query
      WHERE kc.search_vector @@ query.tsq
        AND NOT (kc.document_id = ANY($3::uuid[]))
      ORDER BY score DESC
      LIMIT 20
    ),
    semantic AS (
      SELECT kc.id, 1 - (kc.embedding <=> query.embedding) AS score
      FROM knowledge_chunks kc, query
      WHERE kc.embedding IS NOT NULL
        AND NOT (kc.document_id = ANY($3::uuid[]))
      ORDER BY kc.embedding <=> query.embedding
      LIMIT 20
    ),
    candidates AS (
      SELECT id FROM lexical UNION SELECT id FROM semantic
    ),
    scored AS (
      SELECT c.id,
        coalesce(l.score / nullif(max(l.score) OVER (), 0), 0) AS lexical_score,
        coalesce((s.score + 1) / nullif(max(s.score + 1) OVER (), 0), 0) AS semantic_score
      FROM candidates c
      LEFT JOIN lexical l ON l.id = c.id
      LEFT JOIN semantic s ON s.id = c.id
    )
    SELECT kc.id AS chunk_id, kc.document_id, sd.title,
      nullif(array_to_string(kc.section_path, ' / '), '') AS section,
      kc.content,
      scored.lexical_score,
      scored.semantic_score,
      (0.45 * scored.lexical_score + 0.55 * scored.semantic_score) AS combined_score
    FROM scored
    JOIN knowledge_chunks kc ON kc.id = scored.id
    JOIN source_documents sd ON sd.id = kc.document_id
    ORDER BY combined_score DESC, kc.id
    LIMIT 12
  `, [requirement, vectorLiteral(embedding), excludedDocumentIds]);

  return result.rows.map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    title: row.title,
    section: row.section,
    content: row.content,
    lexicalScore: Number(row.lexical_score),
    semanticScore: Number(row.semantic_score),
    combinedScore: Number(row.combined_score),
  }));
}
