CREATE TABLE IF NOT EXISTS chat_conversaciones (
  Id_Conversacion BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Tipo ENUM('DIRECTA', 'GRUPAL') NOT NULL,
  Titulo VARCHAR(160) NULL,
  Directa_Usuario_Menor BIGINT UNSIGNED NULL,
  Directa_Usuario_Mayor BIGINT UNSIGNED NULL,
  Creado_Por BIGINT UNSIGNED NULL,
  Fecha_Creacion DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  Ultimo_Mensaje_En DATETIME(3) NULL,
  PRIMARY KEY (Id_Conversacion),
  UNIQUE KEY uq_chat_directa_par (Tipo, Directa_Usuario_Menor, Directa_Usuario_Mayor),
  KEY ix_chat_conv_ultimo (Ultimo_Mensaje_En, Id_Conversacion),
  KEY ix_chat_conv_creador (Creado_Por),
  CONSTRAINT ck_chat_directa_par CHECK (
    (Tipo = 'DIRECTA' AND Directa_Usuario_Menor IS NOT NULL AND Directa_Usuario_Mayor IS NOT NULL
      AND Directa_Usuario_Menor < Directa_Usuario_Mayor)
    OR (Tipo = 'GRUPAL' AND Directa_Usuario_Menor IS NULL AND Directa_Usuario_Mayor IS NULL)
  ),
  CONSTRAINT fk_chat_conv_creador FOREIGN KEY (Creado_Por) REFERENCES usuarios(Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_chat_conv_directa_menor FOREIGN KEY (Directa_Usuario_Menor) REFERENCES usuarios(Id_Usuario)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_chat_conv_directa_mayor FOREIGN KEY (Directa_Usuario_Mayor) REFERENCES usuarios(Id_Usuario)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_participantes (
  Id_Conversacion BIGINT UNSIGNED NOT NULL,
  Id_Usuario BIGINT UNSIGNED NOT NULL,
  Fecha_Entrada DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  Fecha_Salida DATETIME(3) NULL,
  Ultimo_Mensaje_Leido_Id BIGINT UNSIGNED NULL,
  Fecha_Lectura DATETIME(3) NULL,
  PRIMARY KEY (Id_Conversacion, Id_Usuario),
  KEY ix_chat_part_usuario (Id_Usuario, Fecha_Entrada, Id_Conversacion),
  CONSTRAINT fk_chat_part_conv FOREIGN KEY (Id_Conversacion) REFERENCES chat_conversaciones(Id_Conversacion)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_chat_part_usuario FOREIGN KEY (Id_Usuario) REFERENCES usuarios(Id_Usuario)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_mensajes (
  Id_Mensaje BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Conversacion BIGINT UNSIGNED NOT NULL,
  Id_Remite BIGINT UNSIGNED NOT NULL,
  Cuerpo TEXT NOT NULL,
  Fecha_Creacion DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (Id_Mensaje),
  UNIQUE KEY uq_chat_msg_conv_id (Id_Conversacion, Id_Mensaje),
  KEY ix_chat_msg_conv (Id_Conversacion, Id_Mensaje),
  KEY ix_chat_msg_remite (Id_Remite, Fecha_Creacion),
  CONSTRAINT fk_chat_msg_conv FOREIGN KEY (Id_Conversacion) REFERENCES chat_conversaciones(Id_Conversacion)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_chat_msg_remite FOREIGN KEY (Id_Remite) REFERENCES usuarios(Id_Usuario)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE chat_participantes
  ADD CONSTRAINT fk_chat_part_ultimo_mensaje
  FOREIGN KEY (Id_Conversacion, Ultimo_Mensaje_Leido_Id)
  REFERENCES chat_mensajes (Id_Conversacion, Id_Mensaje)
  ON DELETE RESTRICT ON UPDATE CASCADE;
