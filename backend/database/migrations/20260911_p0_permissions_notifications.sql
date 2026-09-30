SET @sql_notificaciones_entidad_id = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notificaciones'
            AND COLUMN_NAME = 'Entidad_Id' AND COLUMN_TYPE = 'varchar(80)'),
  'DO 0',
  'ALTER TABLE notificaciones MODIFY COLUMN Entidad_Id varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL'
);
PREPARE stmt_notificaciones_entidad_id FROM @sql_notificaciones_entidad_id;
EXECUTE stmt_notificaciones_entidad_id;
DEALLOCATE PREPARE stmt_notificaciones_entidad_id;

INSERT INTO permisos (Accion, Codigo_Permiso, Descripcion, Modulo_Permiso)
VALUES
  ('CANCELAR', 'RESERVAS.CANCELAR', 'Cancelar reservas sin eliminarlas', 'Reservas'),
  ('CANCELAR', 'TRANSFERS.CANCELAR', 'Cancelar transfers sin eliminarlos', 'Transfers'),
  ('LEER', 'NOTIFICACIONES.LEER', 'Acceder al centro interno de notificaciones', 'Notificaciones')
ON DUPLICATE KEY UPDATE
  Accion = VALUES(Accion),
  Descripcion = VALUES(Descripcion),
  Modulo_Permiso = VALUES(Modulo_Permiso);

INSERT IGNORE INTO rol_permisos (Id_Rol, Id_Permiso)
SELECT r.Id_Rol, p.Id_Permiso
FROM roles r
INNER JOIN permisos p
  ON p.Codigo_Permiso IN ('RESERVAS.CANCELAR', 'TRANSFERS.CANCELAR', 'NOTIFICACIONES.LEER')
WHERE LOWER(TRIM(r.Nombre_Rol)) IN ('administrador', 'asesor');
