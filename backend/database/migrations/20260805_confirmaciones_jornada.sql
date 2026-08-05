CREATE TABLE IF NOT EXISTS confirmaciones_jornada (
  Id_Confirmacion BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Tour BIGINT UNSIGNED NOT NULL,
  Fecha_Tour DATE NOT NULL,
  Total_Pasajeros INT UNSIGNED NOT NULL DEFAULT 0,
  Total_Viajaron INT UNSIGNED NOT NULL DEFAULT 0,
  Total_No_Viajaron INT UNSIGNED NOT NULL DEFAULT 0,
  Confirmada_En DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Confirmada_Por BIGINT UNSIGNED NULL,
  PRIMARY KEY (Id_Confirmacion),
  UNIQUE KEY ux_confirmaciones_jornada_tour_fecha (Id_Tour, Fecha_Tour),
  KEY idx_confirmaciones_jornada_fecha (Fecha_Tour),
  KEY idx_confirmaciones_jornada_usuario (Confirmada_Por)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
