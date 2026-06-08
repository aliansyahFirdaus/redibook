ALTER TABLE requirement_analysis_runs
  ADD COLUMN delivery_url TEXT,
  ADD COLUMN delivery_document_id TEXT,
  ADD COLUMN delivery_title TEXT;

CREATE INDEX requirement_analysis_runs_delivery_document_id_idx
  ON requirement_analysis_runs (delivery_document_id)
  WHERE delivery_document_id IS NOT NULL;
