-- Enable pgvector extension (Supabase includes this by default)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column and timestamp tracker to candidates
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS embedding vector(1024),
  ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ;

-- IVFFlat index for fast cosine similarity search
-- Note: IVFFlat requires data to be present before creating. If table is empty,
-- use HNSW instead: CREATE INDEX ON candidates USING hnsw (embedding vector_cosine_ops);
-- With 1467 candidates, lists=30 is appropriate (sqrt of row count).
CREATE INDEX IF NOT EXISTS idx_candidates_embedding
  ON candidates USING ivfflat (embedding vector_cosine_ops) WITH (lists = 30);
