SET @ddl = IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='reservas' AND COLUMN_NAME='Eliminada_En'),
  'DO 0', 'ALTER TABLE reservas ADD COLUMN Eliminada_En DATETIME(3) NULL');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='reservas' AND COLUMN_NAME='Eliminada_Por'),
  'DO 0', 'ALTER TABLE reservas ADD COLUMN Eliminada_Por BIGINT UNSIGNED NULL');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='reservas' AND COLUMN_NAME='Motivo_Eliminacion'),
  'DO 0', 'ALTER TABLE reservas ADD COLUMN Motivo_Eliminacion VARCHAR(500) NULL');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl_reservas_eliminada_idx = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservas'
             AND INDEX_NAME = 'ix_reservas_eliminada'),
  'DO 0',
  'ALTER TABLE reservas ADD INDEX ix_reservas_eliminada (Eliminada_En, Fecha_Tour)'
);
PREPARE stmt_reservas_eliminada_idx FROM @ddl_reservas_eliminada_idx;
EXECUTE stmt_reservas_eliminada_idx;
DEALLOCATE PREPARE stmt_reservas_eliminada_idx;

SET @ddl_reservas_eliminada_fk = IF(
  EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
           WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'reservas'
             AND CONSTRAINT_NAME = 'fk_reservas_eliminada_por'),
  'DO 0',
  'ALTER TABLE reservas ADD CONSTRAINT fk_reservas_eliminada_por FOREIGN KEY (Eliminada_Por) REFERENCES usuarios(Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE stmt_reservas_eliminada_fk FROM @ddl_reservas_eliminada_fk;
EXECUTE stmt_reservas_eliminada_fk;
DEALLOCATE PREPARE stmt_reservas_eliminada_fk;

SET @ddl = IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='aforos' AND COLUMN_NAME='Operacion'),
  'DO 0', 'ALTER TABLE aforos ADD COLUMN Operacion ENUM(''FIJAR'', ''USAR_BASE'') NOT NULL DEFAULT ''FIJAR''');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

INSERT INTO roles (Nombre_Rol, Descripcion, Activo)
SELECT 'Mercadeo', 'Baseline de lectura para el área de Mercadeo', 1
WHERE NOT EXISTS (
  SELECT 1 FROM roles WHERE LOWER(TRIM(Nombre_Rol)) = 'mercadeo'
);

INSERT INTO roles (Nombre_Rol, Descripcion, Activo)
SELECT 'Contabilidad', 'Rol del área de Contabilidad; baseline pendiente del módulo', 1
WHERE NOT EXISTS (
  SELECT 1 FROM roles WHERE LOWER(TRIM(Nombre_Rol)) = 'contabilidad'
);

INSERT INTO permisos (Accion, Codigo_Permiso, Descripcion, Modulo_Permiso)
VALUES ('LEER', 'MERCADEO.RESERVAS.LEER', 'Consultar reservas del módulo de Mercadeo', 'Mercadeo')
ON DUPLICATE KEY UPDATE
  Accion = VALUES(Accion),
  Descripcion = VALUES(Descripcion),
  Modulo_Permiso = VALUES(Modulo_Permiso);

INSERT IGNORE INTO rol_permisos (Id_Rol, Id_Permiso)
SELECT r.Id_Rol, p.Id_Permiso
  FROM roles r
  JOIN permisos p ON p.Codigo_Permiso IN ('MERCADEO.RESERVAS.LEER', 'TOURS.LEER', 'PUNTOS.LEER')
 WHERE LOWER(TRIM(r.Nombre_Rol)) = 'mercadeo';

DELETE rp
  FROM rol_permisos rp
  JOIN roles r ON r.Id_Rol = rp.Id_Rol
  JOIN permisos p ON p.Id_Permiso = rp.Id_Permiso
 WHERE LOWER(TRIM(r.Nombre_Rol)) = 'mercadeo'
   AND p.Codigo_Permiso = 'TRANSFERS.LEER';

INSERT INTO permisos_cache_revision (Tipo, Id_Entidad, Revision)
VALUES ('CATALOGO', 1, 1)
ON DUPLICATE KEY UPDATE Revision = Revision;
