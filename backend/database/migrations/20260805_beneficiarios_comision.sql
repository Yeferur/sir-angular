CREATE TABLE IF NOT EXISTS beneficiarios_comision (
  Id_Beneficiario BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Canal BIGINT UNSIGNED NOT NULL,
  Tipo_Beneficiario ENUM('HOTEL', 'AGENCIA', 'FREELANCE') NOT NULL,
  Nombre VARCHAR(255) NOT NULL,
  Telefono VARCHAR(50) NULL,
  Forma_Pago ENUM('TRANSFERENCIA_BANCOLOMBIA', 'NEQUI', 'EFECTIVO') NULL,
  Numero_Cuenta VARCHAR(20) NULL,
  Activo TINYINT(1) NOT NULL DEFAULT 1,
  Creado_Por BIGINT UNSIGNED NULL,
  Actualizado_Por BIGINT UNSIGNED NULL,
  Fecha_Creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Fecha_Actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id_Beneficiario),
  KEY idx_beneficiarios_canal_activo_nombre (Id_Canal, Activo, Nombre),
  KEY idx_beneficiarios_creado_por (Creado_Por),
  KEY idx_beneficiarios_actualizado_por (Actualizado_Por),
  CONSTRAINT fk_beneficiarios_canal
    FOREIGN KEY (Id_Canal) REFERENCES canales_reservas (Id_Canal)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_beneficiarios_creado_por
    FOREIGN KEY (Creado_Por) REFERENCES usuarios (Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_beneficiarios_actualizado_por
    FOREIGN KEY (Actualizado_Por) REFERENCES usuarios (Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE reservas
  ADD COLUMN Id_Beneficiario_Comision BIGINT UNSIGNED NULL AFTER Id_Canal,
  ADD KEY idx_reservas_beneficiario_comision (Id_Beneficiario_Comision),
  ADD CONSTRAINT fk_reservas_beneficiario_comision
    FOREIGN KEY (Id_Beneficiario_Comision) REFERENCES beneficiarios_comision (Id_Beneficiario)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE liquidaciones
  ADD COLUMN Id_Beneficiario_Comision BIGINT UNSIGNED NULL AFTER Id_Reserva,
  ADD COLUMN Nombre_Beneficiario_Snap VARCHAR(255) NULL AFTER Id_Beneficiario_Comision,
  ADD COLUMN Fecha_Actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP AFTER Fecha_Registro,
  ADD KEY idx_liquidaciones_beneficiario (Id_Beneficiario_Comision),
  ADD KEY idx_liquidaciones_estado_fecha (Estado, Fecha_Pago, Id_Reserva),
  ADD CONSTRAINT fk_liquidaciones_beneficiario_comision
    FOREIGN KEY (Id_Beneficiario_Comision) REFERENCES beneficiarios_comision (Id_Beneficiario)
    ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE liquidaciones
SET Forma_Pago = NULL
WHERE Forma_Pago = '';
