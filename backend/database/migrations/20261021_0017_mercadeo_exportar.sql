INSERT INTO permisos (Accion, Codigo_Permiso, Descripcion, Modulo_Permiso)
VALUES ('EXPORTAR','MERCADEO.EXPORTAR','Exportar informes de Mercadeo','Mercadeo')
ON DUPLICATE KEY UPDATE Accion=VALUES(Accion), Descripcion=VALUES(Descripcion),
  Modulo_Permiso=VALUES(Modulo_Permiso);

INSERT IGNORE INTO rol_permisos (Id_Rol, Id_Permiso)
SELECT r.Id_Rol, p.Id_Permiso
FROM roles r
JOIN permisos p ON p.Codigo_Permiso='MERCADEO.EXPORTAR'
WHERE LOWER(TRIM(r.Nombre_Rol)) IN ('mercadeo','administrador');

INSERT INTO permisos_cache_revision (Tipo, Id_Entidad, Revision)
VALUES ('CATALOGO',1,1)
ON DUPLICATE KEY UPDATE Revision=Revision+1;
