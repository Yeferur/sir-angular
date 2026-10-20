CREATE TABLE IF NOT EXISTS perfiles_comision_entidad (
  Id_Perfil_Comision BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Entidad_Reportante BIGINT UNSIGNED NOT NULL,
  Forma_Pago ENUM('TRANSFERENCIA_BANCOLOMBIA','NEQUI','EFECTIVO') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  Numero_Cuenta VARCHAR(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  Nombre_Receptor VARCHAR(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  DNI_Receptor VARCHAR(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  Activo TINYINT(1) NOT NULL DEFAULT 1,
  Creado_Por BIGINT UNSIGNED DEFAULT NULL,
  Actualizado_Por BIGINT UNSIGNED DEFAULT NULL,
  Fecha_Registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Fecha_Actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id_Perfil_Comision),
  UNIQUE KEY ux_perfiles_comision_entidad (Id_Entidad_Reportante),
  KEY ix_perfiles_comision_creado_por (Creado_Por),
  KEY ix_perfiles_comision_actualizado_por (Actualizado_Por),
  CONSTRAINT fk_perfiles_comision_entidad FOREIGN KEY (Id_Entidad_Reportante)
    REFERENCES entidades_reportantes (Id_Entidad_Reportante) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_perfiles_comision_creado_por FOREIGN KEY (Creado_Por)
    REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_perfiles_comision_actualizado_por FOREIGN KEY (Actualizado_Por)
    REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql_monto_comision_pagada = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='liquidaciones' AND COLUMN_NAME='Monto_Comision_Pagada'),
  'DO 0',
  'ALTER TABLE liquidaciones ADD COLUMN Monto_Comision_Pagada DECIMAL(10,0) NULL AFTER Fecha_Pago'
);
PREPARE stmt_monto_comision_pagada FROM @sql_monto_comision_pagada;
EXECUTE stmt_monto_comision_pagada;
DEALLOCATE PREPARE stmt_monto_comision_pagada;
