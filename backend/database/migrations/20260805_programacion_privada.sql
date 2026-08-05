ALTER TABLE programaciones
  ADD COLUMN Tipo_Programacion ENUM('grupal', 'privada') NOT NULL DEFAULT 'grupal' AFTER Estado,
  ADD KEY idx_programaciones_fecha_tipo_estado (Fecha_Tour, Tipo_Programacion, Estado);

