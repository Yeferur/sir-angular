-- Add soft-delete support to tours table.
-- Safe to run once; if the column exists it should be skipped manually.

ALTER TABLE tours
  ADD COLUMN Activo TINYINT(1) NOT NULL DEFAULT 1 AFTER Longitud;

CREATE INDEX idx_tours_activo ON tours (Activo);
