ALTER TABLE beneficiarios_comision
  ADD COLUMN Nombre_Receptor varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER Numero_Cuenta,
  ADD COLUMN DNI_Receptor varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER Nombre_Receptor;

ALTER TABLE liquidaciones
  ADD COLUMN Nombre_Receptor_Snap varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER Cuenta_Bancaria,
  ADD COLUMN DNI_Receptor_Snap varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER Nombre_Receptor_Snap;

CREATE TABLE beneficiarios_comision_documentos (
  Id_Documento bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Beneficiario bigint UNSIGNED NOT NULL,
  Nombre_Original varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  Nombre_Almacenado varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  Ruta_Privada varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  Mime_Type varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  Tamano_Bytes bigint UNSIGNED NOT NULL,
  Creado_Por bigint UNSIGNED DEFAULT NULL,
  Fecha_Creacion datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (Id_Documento),
  KEY idx_beneficiario_documentos_beneficiario (Id_Beneficiario),
  CONSTRAINT fk_beneficiario_documentos_beneficiario FOREIGN KEY (Id_Beneficiario) REFERENCES beneficiarios_comision (Id_Beneficiario) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_beneficiario_documentos_usuario FOREIGN KEY (Creado_Por) REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
