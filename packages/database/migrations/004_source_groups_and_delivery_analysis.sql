CREATE TABLE source_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_type TEXT NOT NULL CHECK (group_type IN ('sprint', 'feature')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  outline_collection_id TEXT,
  outline_node_id TEXT,
  outline_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (group_type = 'sprint' AND outline_node_id IS NOT NULL)
    OR (group_type = 'feature' AND outline_node_id IS NULL)
  )
);

CREATE UNIQUE INDEX source_groups_sprint_outline_unique
  ON source_groups (group_type, outline_collection_id, outline_node_id)
  WHERE group_type = 'sprint';

CREATE UNIQUE INDEX source_groups_feature_name_unique
  ON source_groups (lower(name))
  WHERE group_type = 'feature';

CREATE INDEX source_groups_type_idx ON source_groups (group_type, name);

CREATE TABLE source_document_groups (
  group_id UUID NOT NULL REFERENCES source_groups(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, document_id)
);

CREATE INDEX source_document_groups_document_id_idx ON source_document_groups (document_id);

ALTER TABLE requirement_analysis_runs
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'requirement'
    CHECK (mode IN ('requirement', 'delivery')),
  ADD COLUMN source_group_id UUID REFERENCES source_groups(id) ON DELETE SET NULL,
  ADD COLUMN input_prompt TEXT;
