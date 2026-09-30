-- Esquemas que antes eran creados desde servicios. Aplicar antes del backend nuevo.
CREATE TABLE IF NOT EXISTS historial_cambios (
  Id_Cambio BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Tabla VARCHAR(100) NOT NULL,
  Id_Registro VARCHAR(50) DEFAULT NULL,
  Id_Usuario BIGINT UNSIGNED DEFAULT NULL,
  Cambio_JSON JSON NOT NULL,
  IP_Cliente VARCHAR(64) DEFAULT NULL,
  Fecha_Registro DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (Id_Cambio),
  KEY idx_historial_cambios_tabla (Tabla),
  KEY idx_historial_cambios_registro (Id_Registro),
  KEY idx_historial_cambios_usuario (Id_Usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE IF NOT EXISTS disponibilidad (
  Id_Disponibilidad BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Tour BIGINT UNSIGNED NOT NULL,
  Fecha_Tour DATE NOT NULL,
  Cupos_Totales INT NOT NULL DEFAULT 0,
  Cupos_Disponibles INT NOT NULL DEFAULT 0,
  Updated_At DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (Id_Disponibilidad),
  UNIQUE KEY ux_disponibilidad_tour_fecha (Id_Tour, Fecha_Tour)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- El servicio aceptaba cualquier tipo de texto y convertía otros tipos.
-- No reducir un campo de texto preexistente ni alterar datos existentes.
SET @sql_historial_id_registro = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'historial'
            AND COLUMN_NAME = 'Id_Registro'
            AND DATA_TYPE NOT IN ('varchar', 'text', 'mediumtext', 'longtext')),
  'ALTER TABLE historial MODIFY COLUMN Id_Registro VARCHAR(50) NULL',
  'DO 0'
);
PREPARE stmt_historial_id_registro FROM @sql_historial_id_registro;
EXECUTE stmt_historial_id_registro;
DEALLOCATE PREPARE stmt_historial_id_registro;
