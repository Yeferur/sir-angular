-- Align historial with alphanumeric business IDs (e.g., reservas TG10146).
-- Run once in environments where Id_Registro is numeric.

ALTER TABLE historial
  MODIFY COLUMN Id_Registro VARCHAR(50) NULL;
