CREATE TABLE IF NOT EXISTS schema_migrations (
  Migration_Id VARCHAR(190) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  Version VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  Checksum_SHA256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  Estado ENUM('APLICANDO','APLICADA','FALLIDA') NOT NULL,
  Iniciada_En DATETIME(3) NOT NULL,
  Aplicada_En DATETIME(3) NULL,
  Duracion_Ms BIGINT UNSIGNED NULL,
  Paso_Actual VARCHAR(190) NULL,
  Error_Resumen VARCHAR(1000) NULL,
  Aplicada_Por VARCHAR(128) NULL,
  PRIMARY KEY (Migration_Id),
  KEY ix_schema_migrations_estado_fecha (Estado, Iniciada_En)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
