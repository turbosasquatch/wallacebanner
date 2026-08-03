CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size > 0),
  etag TEXT,
  fingerprint TEXT UNIQUE,
  uploaded_at TEXT NOT NULL,
  original_name TEXT,
  uploader TEXT,
  poster_key TEXT,
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1))
);

CREATE INDEX IF NOT EXISTS media_gallery_idx
  ON media (published, uploaded_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS gallery_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
  reserved_images INTEGER NOT NULL DEFAULT 0 CHECK (reserved_images >= 0),
  total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  day TEXT NOT NULL,
  daily_sources INTEGER NOT NULL DEFAULT 0 CHECK (daily_sources >= 0),
  daily_puts INTEGER NOT NULL DEFAULT 0 CHECK (daily_puts >= 0)
);

INSERT OR IGNORE INTO gallery_state (id, day) VALUES (1, '1970-01-01');

CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  poster_key TEXT UNIQUE,
  content_type TEXT NOT NULL,
  source_size INTEGER NOT NULL CHECK (source_size > 0),
  poster_size INTEGER NOT NULL DEFAULT 0 CHECK (poster_size >= 0),
  original_name TEXT NOT NULL,
  uploader TEXT,
  reserved_image INTEGER NOT NULL CHECK (reserved_image IN (0, 1)),
  source_uploaded INTEGER NOT NULL DEFAULT 0 CHECK (source_uploaded IN (0, 1)),
  poster_uploaded INTEGER NOT NULL DEFAULT 0 CHECK (poster_uploaded IN (0, 1)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS upload_sessions_expiry_idx ON upload_sessions (expires_at);
