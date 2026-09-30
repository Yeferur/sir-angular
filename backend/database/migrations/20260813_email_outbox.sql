-- Actualización de instalaciones existentes. Para instalaciones nuevas, sir.sql
-- incluye el mismo esquema base (y el enum reminder posterior).
CREATE TABLE IF NOT EXISTS email_outbox (
  Id_Email BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Tipo ENUM('password_reset','schedule') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  Prioridad SMALLINT NOT NULL DEFAULT 0,
  Destinatario VARCHAR(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  Payload JSON NOT NULL,
  Dedupe_Key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  Estado ENUM('pendiente','procesando','enviado','fallido') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pendiente',
  Intentos SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  Max_Intentos SMALLINT UNSIGNED NOT NULL DEFAULT 24,
  Disponible_En DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  Expira_En DATETIME(3) DEFAULT NULL,
  Bloqueado_En DATETIME(3) DEFAULT NULL,
  Bloqueado_Por VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  Enviado_En DATETIME(3) DEFAULT NULL,
  Fallido_En DATETIME(3) DEFAULT NULL,
  Smtp_Message_Id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  Ultimo_Error TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  Fecha_Creacion DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  Fecha_Actualizacion DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (Id_Email),
  UNIQUE KEY ux_email_outbox_dedupe (Dedupe_Key),
  KEY idx_email_outbox_dispatch (Estado,Disponible_En,Prioridad,Id_Email),
  KEY idx_email_outbox_lock (Estado,Bloqueado_En)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_outbox_control (
  Id_Control TINYINT UNSIGNED NOT NULL,
  Pausado_Hasta DATETIME(3) DEFAULT NULL,
  Motivo VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  Fecha_Actualizacion DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (Id_Control)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_outbox_dispatches (
  Id_Despacho BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Email BIGINT UNSIGNED NOT NULL,
  Tipo ENUM('password_reset','schedule') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  Reservado_En DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (Id_Despacho),
  KEY idx_email_dispatches_quota (Reservado_En,Tipo),
  KEY idx_email_dispatches_email (Id_Email),
  CONSTRAINT fk_email_dispatches_outbox FOREIGN KEY (Id_Email)
    REFERENCES email_outbox (Id_Email) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- sir.sql agrega esta FK después de crear las tablas; instalaciones antiguas
-- pueden tener las tablas sin esa relación.
SET @sql_email_dispatch_fk = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'email_outbox_dispatches'
            AND CONSTRAINT_NAME = 'fk_email_dispatches_outbox'),
  'DO 0',
  'ALTER TABLE email_outbox_dispatches ADD CONSTRAINT fk_email_dispatches_outbox FOREIGN KEY (Id_Email) REFERENCES email_outbox (Id_Email) ON DELETE CASCADE ON UPDATE CASCADE'
);
PREPARE stmt_email_dispatch_fk FROM @sql_email_dispatch_fk;
EXECUTE stmt_email_dispatch_fk;
DEALLOCATE PREPARE stmt_email_dispatch_fk;
