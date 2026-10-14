-- La clave normalizada solo detecta equivalencias; Nombre conserva su escritura original.
ALTER TABLE entidades_reportantes
  ADD COLUMN Nombre_Normalizado VARCHAR(255) NOT NULL AFTER Nombre,
  ADD UNIQUE KEY ux_entidades_tipo_nombre_normalizado (Tipo, Nombre_Normalizado);

INSERT IGNORE INTO rol_permisos (Id_Rol, Id_Permiso)
SELECT r.Id_Rol, p.Id_Permiso FROM roles r JOIN permisos p
  ON p.Codigo_Permiso IN ('ENTIDADES_REPORTANTES.LEER','ENTIDADES_REPORTANTES.CREAR',
    'ENTIDADES_REPORTANTES.ACTUALIZAR','ENTIDADES_REPORTANTES.VALIDAR')
WHERE LOWER(TRIM(r.Nombre_Rol))='mercadeo';

INSERT INTO permisos_cache_revision (Tipo, Id_Entidad, Revision)
VALUES ('CATALOGO',1,1) ON DUPLICATE KEY UPDATE Revision=Revision+1;
