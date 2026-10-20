-- Registro de datos del catálogo existente. No modifica el schema ni asigna roles.
INSERT INTO permisos (Accion, Codigo_Permiso, Descripcion, Modulo_Permiso) VALUES
  ('LEER', 'PUNTOS.RESERVAS.LEER', 'Consultar reservas asociadas a puntos de encuentro', 'Puntos de encuentro'),
  ('EXPORTAR', 'PUNTOS.RESERVAS.EXPORTAR', 'Exportar reservas asociadas a puntos de encuentro', 'Puntos de encuentro')
ON DUPLICATE KEY UPDATE Accion=VALUES(Accion), Descripcion=VALUES(Descripcion), Modulo_Permiso=VALUES(Modulo_Permiso);

INSERT INTO permisos_cache_revision (Tipo, Id_Entidad, Revision)
VALUES ('CATALOGO', 1, 1) ON DUPLICATE KEY UPDATE Revision=Revision+1;
