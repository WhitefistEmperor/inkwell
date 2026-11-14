-- Inkwell schema. Seven tables: three entities (users, articles, comments)
-- and four relationship tables (follows, favorites, tags, article_tags).

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,          -- always stored lowercase
  password_hash TEXT NOT NULL,                 -- bcrypt hash, never the password
  bio           TEXT NOT NULL DEFAULT '',
  image         TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Sahil" and "sahil" must not both exist, so uniqueness is on the lowercase form.
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));

CREATE TABLE articles (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,            -- URL identifier, e.g. "my-title-x7k2p9"
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  body        TEXT NOT NULL,
  author_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX articles_author_idx  ON articles (author_id);
CREATE INDEX articles_created_idx ON articles (created_at DESC, id DESC);  -- feed ordering

CREATE TABLE comments (
  id         SERIAL PRIMARY KEY,
  body       TEXT NOT NULL,
  article_id INTEGER NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX comments_article_idx ON comments (article_id);

-- Many-to-many: a user follows many users. The composite primary key makes
-- "follow twice" impossible at the database level.
CREATE TABLE follows (
  follower_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);

CREATE INDEX follows_followee_idx ON follows (followee_id);

-- Many-to-many: users favorite articles.
CREATE TABLE favorites (
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, article_id)
);

CREATE INDEX favorites_article_idx ON favorites (article_id);

-- Many-to-many: articles have tags. Tags are normalised into their own table
-- so each tag name is stored once.
CREATE TABLE tags (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE article_tags (
  article_id INTEGER NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);

CREATE INDEX article_tags_tag_idx ON article_tags (tag_id);
