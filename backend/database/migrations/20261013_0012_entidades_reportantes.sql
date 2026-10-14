-- Un catálogo común: la entidad comercial es independiente del contacto y del punto.
CREATE TABLE IF NOT EXISTS entidades_reportantes (
  Id_Entidad_Reportante BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Tipo ENUM('HOTEL','AGENCIA_NACIONAL','AGENCIA_INTERNACIONAL') NOT NULL,
  Nombre VARCHAR(255) NOT NULL,
  Activo TINYINT(1) NOT NULL DEFAULT 1,
  Estado_Validacion ENUM('PENDIENTE_VALIDACION','VALIDADA','RECHAZADA') NOT NULL DEFAULT 'PENDIENTE_VALIDACION',
  Creado_Por BIGINT UNSIGNED NULL,
  Fecha_Creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Actualizado_Por BIGINT UNSIGNED NULL,
  Fecha_Actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  Validado_Por BIGINT UNSIGNED NULL,
  Validado_En DATETIME NULL,
  PRIMARY KEY (Id_Entidad_Reportante),
  UNIQUE KEY ux_entidades_tipo_nombre (Tipo, Nombre),
  KEY ix_entidades_tipo_activo_estado (Tipo, Activo, Estado_Validacion),
  KEY ix_entidades_creado_por (Creado_Por),
  KEY ix_entidades_actualizado_por (Actualizado_Por),
  KEY ix_entidades_validado_por (Validado_Por),
  CONSTRAINT fk_entidades_creado_por FOREIGN KEY (Creado_Por) REFERENCES usuarios(Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_entidades_actualizado_por FOREIGN KEY (Actualizado_Por) REFERENCES usuarios(Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_entidades_validado_por FOREIGN KEY (Validado_Por) REFERENCES usuarios(Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS entidad_reportante_puntos (
  Id_Entidad_Reportante BIGINT UNSIGNED NOT NULL,
  Id_Punto BIGINT UNSIGNED NOT NULL,
  Estado_Validacion ENUM('PENDIENTE_VALIDACION','VALIDADA','RECHAZADA') NOT NULL DEFAULT 'PENDIENTE_VALIDACION',
  Creado_Por BIGINT UNSIGNED NULL,
  Fecha_Creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Actualizado_Por BIGINT UNSIGNED NULL,
  Fecha_Actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  Validado_Por BIGINT UNSIGNED NULL,
  Validado_En DATETIME NULL,
  PRIMARY KEY (Id_Entidad_Reportante, Id_Punto),
  KEY ix_entidad_puntos_punto (Id_Punto),
  KEY ix_entidad_puntos_validado_por (Validado_Por),
  KEY ix_entidad_puntos_creado_por (Creado_Por),
  KEY ix_entidad_puntos_actualizado_por (Actualizado_Por),
  CONSTRAINT fk_entidad_puntos_entidad FOREIGN KEY (Id_Entidad_Reportante) REFERENCES entidades_reportantes(Id_Entidad_Reportante) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_entidad_puntos_punto FOREIGN KEY (Id_Punto) REFERENCES puntos(Id_Punto) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_entidad_puntos_creado_por FOREIGN KEY (Creado_Por) REFERENCES usuarios(Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_entidad_puntos_actualizado_por FOREIGN KEY (Actualizado_Por) REFERENCES usuarios(Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_entidad_puntos_validado_por FOREIGN KEY (Validado_Por) REFERENCES usuarios(Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql_entidad_reserva_col = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='reservas' AND COLUMN_NAME='Id_Entidad_Reportante'),
  'DO 0',
  'ALTER TABLE reservas ADD COLUMN Id_Entidad_Reportante BIGINT UNSIGNED NULL AFTER Id_Canal'
);
PREPARE stmt_entidad_reserva_col FROM @sql_entidad_reserva_col;
EXECUTE stmt_entidad_reserva_col;
DEALLOCATE PREPARE stmt_entidad_reserva_col;

SET @sql_entidad_reserva_idx = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='reservas' AND INDEX_NAME='ix_reservas_entidad_registro'),
  'DO 0',
  'ALTER TABLE reservas ADD INDEX ix_reservas_entidad_registro (Id_Entidad_Reportante, Fecha_Registro)'
);
PREPARE stmt_entidad_reserva_idx FROM @sql_entidad_reserva_idx;
EXECUTE stmt_entidad_reserva_idx;
DEALLOCATE PREPARE stmt_entidad_reserva_idx;

SET @sql_entidad_reserva_fk = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND TABLE_NAME='reservas' AND CONSTRAINT_NAME='fk_reservas_entidad_reportante'),
  'DO 0',
  'ALTER TABLE reservas ADD CONSTRAINT fk_reservas_entidad_reportante FOREIGN KEY (Id_Entidad_Reportante) REFERENCES entidades_reportantes(Id_Entidad_Reportante) ON DELETE RESTRICT ON UPDATE CASCADE'
);
PREPARE stmt_entidad_reserva_fk FROM @sql_entidad_reserva_fk;
EXECUTE stmt_entidad_reserva_fk;
DEALLOCATE PREPARE stmt_entidad_reserva_fk;

INSERT INTO permisos (Accion, Codigo_Permiso, Descripcion, Modulo_Permiso) VALUES
  ('LEER','ENTIDADES_REPORTANTES.LEER','Consultar entidades reportantes','Entidades reportantes'),
  ('CREAR','ENTIDADES_REPORTANTES.CREAR','Registrar entidades reportantes','Entidades reportantes'),
  ('ACTUALIZAR','ENTIDADES_REPORTANTES.ACTUALIZAR','Editar entidades reportantes','Entidades reportantes'),
  ('VALIDAR','ENTIDADES_REPORTANTES.VALIDAR','Validar entidades y relaciones con puntos','Entidades reportantes')
ON DUPLICATE KEY UPDATE Accion=VALUES(Accion), Descripcion=VALUES(Descripcion), Modulo_Permiso=VALUES(Modulo_Permiso);

INSERT INTO permisos_cache_revision (Tipo, Id_Entidad, Revision)
VALUES ('CATALOGO',1,1) ON DUPLICATE KEY UPDATE Revision=Revision+1;
