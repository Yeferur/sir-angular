-- Ausencia de fila equivale a revisión 0; no hace falta cargar usuarios/roles.
-- Si la tabla ya existe, el runner verifica su compatibilidad sin borrar datos.
CREATE TABLE IF NOT EXISTS permisos_cache_revision (
  Tipo ENUM('ROL', 'USUARIO') NOT NULL,
  Id_Entidad BIGINT UNSIGNED NOT NULL,
  Revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (Tipo, Id_Entidad)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
