CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE source_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'outline')),
  outline_document_id TEXT,
  outline_url TEXT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  markdown TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  index_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (index_status IN ('pending', 'normalizing', 'embedding', 'ready', 'failed')),
  index_error TEXT,
  indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (source_type = 'manual' AND outline_document_id IS NULL)
    OR (source_type = 'outline' AND outline_document_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX source_documents_outline_id_unique
  ON source_documents (outline_document_id)
  WHERE outline_document_id IS NOT NULL;
CREATE INDEX source_documents_updated_at_idx ON source_documents (updated_at DESC, id DESC);

CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  section_path TEXT[] NOT NULL DEFAULT '{}',
  heading TEXT,
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  token_count INTEGER NOT NULL CHECK (token_count > 0),
  content_hash TEXT NOT NULL,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(heading, '') || ' ' || content)
  ) STORED,
  embedding VECTOR(1536),
  embedding_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, ordinal)
);

CREATE INDEX knowledge_chunks_document_id_idx ON knowledge_chunks (document_id);
CREATE INDEX knowledge_chunks_search_vector_idx ON knowledge_chunks USING GIN (search_vector);
CREATE INDEX knowledge_chunks_embedding_hnsw_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE TABLE requirement_analysis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement TEXT NOT NULL CHECK (length(trim(requirement)) > 0),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'retrieving', 'analyzing', 'completed', 'failed')),
  quality_result JSONB NOT NULL CHECK (jsonb_typeof(quality_result) = 'object'),
  impact_result JSONB,
  provider TEXT,
  model TEXT,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX requirement_analysis_runs_created_at_idx
  ON requirement_analysis_runs (created_at DESC, id DESC);

CREATE TABLE retrieved_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES requirement_analysis_runs(id) ON DELETE CASCADE,
  chunk_id UUID NOT NULL REFERENCES knowledge_chunks(id) ON DELETE RESTRICT,
  rank INTEGER NOT NULL CHECK (rank > 0),
  lexical_score DOUBLE PRECISION NOT NULL CHECK (lexical_score >= 0),
  semantic_score DOUBLE PRECISION NOT NULL CHECK (semantic_score >= 0),
  combined_score DOUBLE PRECISION NOT NULL CHECK (combined_score >= 0),
  title_snapshot TEXT NOT NULL,
  section_snapshot TEXT,
  excerpt_snapshot TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, chunk_id),
  UNIQUE (run_id, rank)
);

CREATE INDEX retrieved_evidence_run_id_idx ON retrieved_evidence (run_id, rank);
CREATE INDEX retrieved_evidence_chunk_id_idx ON retrieved_evidence (chunk_id);
