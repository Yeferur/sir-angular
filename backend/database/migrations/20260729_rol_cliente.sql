-- El rol Cliente se crea sin permisos base mientras la aplicación incorpora
-- el alcance de "reservas propias". Conceder RESERVAS.* hoy daría acceso global.
INSERT INTO roles (Nombre_Rol, Descripcion, Activo)
VALUES ('Cliente', 'Acceso limitado a reservas propias', 1)
ON DUPLICATE KEY UPDATE
  Descripcion = VALUES(Descripcion),
  Activo = VALUES(Activo);
