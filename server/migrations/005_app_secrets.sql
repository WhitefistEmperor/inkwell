-- Server-side secrets the app generates for itself (see src/secret.js).
CREATE TABLE app_secrets (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
