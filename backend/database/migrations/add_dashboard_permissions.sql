-- Add Dashboard module and permissions for granular access control.
-- Safe to run multiple times.

INSERT INTO modulos (Nombre_Modulo, Codigo_Modulo, Descripcion, Icono, Ruta, Orden, Activo)
SELECT 'Dashboard', 'DASHBOARD', 'Dashboard de analitica', NULL, '/Dashboard', 12, 1
WHERE NOT EXISTS (
  SELECT 1 FROM modulos WHERE Codigo_Modulo = 'DASHBOARD'
);

INSERT INTO permisos (Id_Modulo, Accion, Codigo_Permiso, Descripcion)
SELECT m.Id_Modulo, 'LEER', 'DASHBOARD.LEER', 'Ver dashboard'
FROM modulos m
WHERE m.Codigo_Modulo = 'DASHBOARD'
  AND NOT EXISTS (
    SELECT 1 FROM permisos p WHERE p.Codigo_Permiso = 'DASHBOARD.LEER'
  );

INSERT INTO permisos (Id_Modulo, Accion, Codigo_Permiso, Descripcion)
SELECT m.Id_Modulo, 'ACTUALIZAR', 'DASHBOARD.ACTUALIZAR', 'Actualizar configuracion dashboard'
FROM modulos m
WHERE m.Codigo_Modulo = 'DASHBOARD'
  AND NOT EXISTS (
    SELECT 1 FROM permisos p WHERE p.Codigo_Permiso = 'DASHBOARD.ACTUALIZAR'
  );

-- Grant dashboard read to admin role by default.
INSERT INTO rol_permisos (Id_Rol, Id_Permiso, Fecha_Asignacion)
SELECT 1, p.Id_Permiso, NOW()
FROM permisos p
WHERE p.Codigo_Permiso = 'DASHBOARD.LEER'
  AND NOT EXISTS (
    SELECT 1 FROM rol_permisos rp WHERE rp.Id_Rol = 1 AND rp.Id_Permiso = p.Id_Permiso
  );
