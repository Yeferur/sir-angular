ALTER TABLE notificaciones
  MODIFY COLUMN Entidad_Id varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL;

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
