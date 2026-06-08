ALTER TABLE retrieved_evidence
  DROP CONSTRAINT retrieved_evidence_chunk_id_fkey,
  ADD CONSTRAINT retrieved_evidence_chunk_id_fkey
  FOREIGN KEY (chunk_id) REFERENCES knowledge_chunks(id) ON DELETE CASCADE;