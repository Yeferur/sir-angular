-- Lotes de pago de comisiones por entidad y fecha de tour.
-- Los lotes anulados conservan los datos del pago y su comprobante como historial.
CREATE TABLE IF NOT EXISTS comisiones_grupos_pago (
  Id_Grupo_Comision BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Entidad_Reportante BIGINT UNSIGNED NOT NULL,
  Fecha_Tour DATE NOT NULL,
  Numero_Lote INT UNSIGNED NOT NULL DEFAULT 1,
  Estado ENUM('PENDIENTE','PAGADO','ANULADO') NOT NULL DEFAULT 'PENDIENTE',
  Fecha_Pago DATE DEFAULT NULL,
  Monto_Pagado DECIMAL(10,0) DEFAULT NULL,
  Cantidad_Reservas_Pagadas INT UNSIGNED DEFAULT NULL,
  Pagado_Por BIGINT UNSIGNED DEFAULT NULL,
  Nombre_Beneficiario_Snap VARCHAR(255) DEFAULT NULL,
  Forma_Pago ENUM('TRANSFERENCIA_BANCOLOMBIA','NEQUI','EFECTIVO') DEFAULT NULL,
  Cuenta_Bancaria VARCHAR(80) DEFAULT NULL,
  Nombre_Receptor_Snap VARCHAR(255) DEFAULT NULL,
  DNI_Receptor_Snap VARCHAR(50) DEFAULT NULL,
  Comprobante_Ruta VARCHAR(500) DEFAULT NULL COMMENT 'Ruta relativa dentro del almacenamiento privado de Comisiones.',
  Comprobante_Nombre_Original VARCHAR(255) DEFAULT NULL,
  Comprobante_Mime_Type VARCHAR(100) DEFAULT NULL,
  Comprobante_Tamano_Bytes BIGINT UNSIGNED DEFAULT NULL,
  Comprobante_Subido_En DATETIME DEFAULT NULL,
  Comprobante_Subido_Por BIGINT UNSIGNED DEFAULT NULL,
  Motivo_Anulacion TEXT NULL,
  Anulado_Por BIGINT UNSIGNED DEFAULT NULL,
  Anulado_En DATETIME DEFAULT NULL,
  Fecha_Creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Fecha_Actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id_Grupo_Comision),
  UNIQUE KEY ux_comisiones_grupo_entidad_fecha_lote (Id_Entidad_Reportante, Fecha_Tour, Numero_Lote),
  KEY ix_comisiones_grupo_fecha_estado (Fecha_Tour, Estado),
  KEY ix_comisiones_grupo_pagado_por (Pagado_Por),
  KEY ix_comisiones_grupo_comprobante_subido_por (Comprobante_Subido_Por),
  KEY ix_comisiones_grupo_anulado_por (Anulado_Por),
  CONSTRAINT fk_comisiones_grupo_entidad
    FOREIGN KEY (Id_Entidad_Reportante) REFERENCES entidades_reportantes (Id_Entidad_Reportante)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_comisiones_grupo_pagado_por
    FOREIGN KEY (Pagado_Por) REFERENCES usuarios (Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_comisiones_grupo_comprobante_subido_por
    FOREIGN KEY (Comprobante_Subido_Por) REFERENCES usuarios (Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_comisiones_grupo_anulado_por
    FOREIGN KEY (Anulado_Por) REFERENCES usuarios (Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Composición inmutable de cada lote pagado; permite soltar la liquidación activa al anularlo.
CREATE TABLE IF NOT EXISTS comisiones_grupos_pago_reservas (
  Id_Grupo_Comision BIGINT UNSIGNED NOT NULL,
  Id_Reserva VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  Monto_Comision_Pagada DECIMAL(10,0) NOT NULL,
  PRIMARY KEY (Id_Grupo_Comision, Id_Reserva),
  KEY ix_comisiones_grupo_reservas_reserva (Id_Reserva),
  CONSTRAINT fk_comisiones_grupo_reservas_grupo
    FOREIGN KEY (Id_Grupo_Comision) REFERENCES comisiones_grupos_pago (Id_Grupo_Comision)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_comisiones_grupo_reservas_reserva
    FOREIGN KEY (Id_Reserva) REFERENCES reservas (Id_Reserva)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql_comisiones_liquidacion_grupo_col = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='liquidaciones' AND COLUMN_NAME='Id_Grupo_Comision'),
  'DO 0',
  'ALTER TABLE liquidaciones ADD COLUMN Id_Grupo_Comision BIGINT UNSIGNED NULL AFTER Id_Reserva'
);
PREPARE stmt_comisiones_liquidacion_grupo_col FROM @sql_comisiones_liquidacion_grupo_col;
EXECUTE stmt_comisiones_liquidacion_grupo_col;
DEALLOCATE PREPARE stmt_comisiones_liquidacion_grupo_col;

SET @sql_comisiones_liquidacion_grupo_idx = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='liquidaciones' AND INDEX_NAME='ix_liquidaciones_grupo_comision'),
  'DO 0',
  'ALTER TABLE liquidaciones ADD INDEX ix_liquidaciones_grupo_comision (Id_Grupo_Comision)'
);
PREPARE stmt_comisiones_liquidacion_grupo_idx FROM @sql_comisiones_liquidacion_grupo_idx;
EXECUTE stmt_comisiones_liquidacion_grupo_idx;
DEALLOCATE PREPARE stmt_comisiones_liquidacion_grupo_idx;

SET @sql_comisiones_liquidacion_grupo_fk = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND TABLE_NAME='liquidaciones' AND CONSTRAINT_NAME='fk_liquidaciones_grupo_comision'),
  'DO 0',
  'ALTER TABLE liquidaciones ADD CONSTRAINT fk_liquidaciones_grupo_comision FOREIGN KEY (Id_Grupo_Comision) REFERENCES comisiones_grupos_pago (Id_Grupo_Comision) ON DELETE RESTRICT ON UPDATE CASCADE'
);
PREPARE stmt_comisiones_liquidacion_grupo_fk FROM @sql_comisiones_liquidacion_grupo_fk;
EXECUTE stmt_comisiones_liquidacion_grupo_fk;
DEALLOCATE PREPARE stmt_comisiones_liquidacion_grupo_fk;
