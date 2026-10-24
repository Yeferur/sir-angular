-- El rol Mercadeo necesita acceso de solo lectura a reservas y transfers.
-- Los códigos ya existen en el catálogo de identidad; no se crean permisos de escritura.
INSERT IGNORE INTO rol_permisos (Id_Rol, Id_Permiso)
SELECT r.Id_Rol, p.Id_Permiso
FROM roles r
JOIN permisos p ON p.Codigo_Permiso IN ('TRANSFERS.LEER','RESERVAS.LEER')
WHERE LOWER(TRIM(r.Nombre_Rol))='mercadeo';

INSERT INTO permisos_cache_revision (Tipo, Id_Entidad, Revision)
VALUES ('CATALOGO',1,1)
ON DUPLICATE KEY UPDATE Revision=Revision+1;
