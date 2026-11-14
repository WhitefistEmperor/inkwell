-- Full-text search. `search` is a generated column: PostgreSQL recomputes it
-- automatically whenever title, description or body change, so it can never
-- go stale. Weights make a match in the title (A) rank above one in the
-- description (B), which ranks above one in the body (C).
ALTER TABLE articles ADD COLUMN search tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', title), 'A') ||
  setweight(to_tsvector('english', description), 'B') ||
  setweight(to_tsvector('english', body), 'C')
) STORED;

-- GIN = inverted index (word -> rows containing it), the same idea a search
-- engine uses. Without it every search would scan every article.
CREATE INDEX articles_search_idx ON articles USING GIN (search);
