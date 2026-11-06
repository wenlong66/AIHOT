CREATE TABLE term_radar_snapshots (
  day date PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  terms jsonb NOT NULL
);
