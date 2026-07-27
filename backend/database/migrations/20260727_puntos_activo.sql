ALTER TABLE puntos
  ADD COLUMN Activo TINYINT(1) NOT NULL DEFAULT 1 AFTER Longitud,
  ADD KEY idx_puntos_activo_ruta_pos (Activo, ruta, posicion, Id_Punto);

UPDATE puntos
SET posicion = posicion + 1
WHERE ruta = '0' AND Id_Punto <> 6;

UPDATE puntos
SET ruta = '0', posicion = 1, Activo = 1
WHERE Id_Punto = 6;
