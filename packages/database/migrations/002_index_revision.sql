ALTER TABLE source_documents
  ADD COLUMN index_revision BIGINT NOT NULL DEFAULT 1 CHECK (index_revision > 0);
