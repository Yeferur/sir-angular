-- Rol de sistema para clientes externos. Su alcance efectivo también está
-- fijado en backend; estas filas mantienen consistente la administración.
SET @cliente_rol_id := (
  SELECT Id_Rol FROM roles WHERE LOWER(TRIM(Nombre_Rol)) = 'cliente' LIMIT 1
);

DELETE up
FROM usuario_permisos up
INNER JOIN usuarios u ON u.Id_Usuario = up.Id_Usuario
WHERE u.Id_Rol = @cliente_rol_id;

DELETE FROM rol_permisos
WHERE Id_Rol = @cliente_rol_id;

INSERT INTO rol_permisos (Id_Rol, Id_Permiso)
SELECT @cliente_rol_id, p.Id_Permiso
FROM permisos p
WHERE @cliente_rol_id IS NOT NULL
  AND p.Codigo_Permiso IN (
    'RESERVAS.LEER',
    'RESERVAS.CREAR',
    'RESERVAS.ACTUALIZAR'
  )
ON DUPLICATE KEY UPDATE Id_Rol = VALUES(Id_Rol);
