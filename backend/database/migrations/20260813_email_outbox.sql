CREATE TABLE IF NOT EXISTS `email_outbox` (
  `Id_Email` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `Tipo` enum('password_reset','schedule') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `Prioridad` smallint NOT NULL DEFAULT '0',
  `Destinatario` varchar(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `Payload` json NOT NULL,
  `Dedupe_Key` varchar(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `Estado` enum('pendiente','procesando','enviado','fallido') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pendiente',
  `Intentos` smallint UNSIGNED NOT NULL DEFAULT '0',
  `Max_Intentos` smallint UNSIGNED NOT NULL DEFAULT '24',
  `Disponible_En` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `Expira_En` datetime(3) DEFAULT NULL,
  `Bloqueado_En` datetime(3) DEFAULT NULL,
  `Bloqueado_Por` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Enviado_En` datetime(3) DEFAULT NULL,
  `Fallido_En` datetime(3) DEFAULT NULL,
  `Smtp_Message_Id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Ultimo_Error` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `Fecha_Creacion` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `Fecha_Actualizacion` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`Id_Email`),
  UNIQUE KEY `ux_email_outbox_dedupe` (`Dedupe_Key`),
  KEY `idx_email_outbox_dispatch` (`Estado`,`Disponible_En`,`Prioridad`,`Id_Email`),
  KEY `idx_email_outbox_lock` (`Estado`,`Bloqueado_En`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `email_outbox_dispatches` (
  `Id_Despacho` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
  `Id_Email` bigint UNSIGNED NOT NULL,
  `Tipo` enum('password_reset','schedule') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `Reservado_En` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`Id_Despacho`),
  KEY `idx_email_dispatches_quota` (`Reservado_En`,`Tipo`),
  KEY `idx_email_dispatches_email` (`Id_Email`),
  CONSTRAINT `fk_email_dispatches_outbox` FOREIGN KEY (`Id_Email`)
    REFERENCES `email_outbox` (`Id_Email`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `email_outbox_control` (
  `Id_Control` tinyint UNSIGNED NOT NULL,
  `Pausado_Hasta` datetime(3) DEFAULT NULL,
  `Motivo` varchar(64) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `Fecha_Actualizacion` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`Id_Control`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
