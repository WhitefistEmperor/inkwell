-- One row per "someone did something involving you".
CREATE TABLE notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,   -- who receives it
  actor_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,   -- who caused it
  type       TEXT NOT NULL CHECK (type IN ('follow', 'favorite', 'comment')),
  article_id INTEGER REFERENCES articles (id) ON DELETE CASCADE,         -- NULL for a follow
  read_at    TIMESTAMPTZ,                                                -- NULL = unread
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Matches the only query we run: "my notifications, newest first".
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
