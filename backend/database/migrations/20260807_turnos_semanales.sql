-- Reemplaza el modelo de "jornada fija indefinida" (turnos_asesores) por
-- turnos rotativos semanales agrupados por canal de ventas. turnos_asesores
-- no tiene datos reales (0 de 14 asesores configurados, verificado 2026-08-07),
-- por lo que se puede sustituir sin migrar datos.

DROP TABLE IF EXISTS turnos_asesores;

-- Canal de ventas: catálogo pequeño y propio de Turnos (distinto de
-- `canales_reservas`, que es la fuente/comisión de una reserva).
CREATE TABLE IF NOT EXISTS canales_turno (
  Id_Canal BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Nombre_Canal VARCHAR(100) NOT NULL,
  Activo TINYINT(1) NOT NULL DEFAULT 1,
  Fecha_Creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Fecha_Actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id_Canal),
  UNIQUE KEY ux_canales_turno_nombre (Nombre_Canal)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO canales_turno (Nombre_Canal) VALUES
  ('Hoteles y Agencias'),
  ('Medios Digitales')
ON DUPLICATE KEY UPDATE Nombre_Canal = VALUES(Nombre_Canal);

-- Canal fijo del asesor. Editable solo para usuarios con rol Asesor
-- (regla aplicada en el wizard de Usuarios, no a nivel de columna).
ALTER TABLE usuarios
  ADD COLUMN Id_Canal BIGINT UNSIGNED NULL AFTER Id_Rol,
  ADD CONSTRAINT fk_usuarios_canal FOREIGN KEY (Id_Canal)
    REFERENCES canales_turno (Id_Canal) ON DELETE SET NULL ON UPDATE CASCADE;

-- Una semana de turnos (lunes a domingo). El tercer estado evita la
-- combinación inválida "borrador con cambios sin publicar" que produciría
-- un booleano aparte junto a un enum de 2 valores.
CREATE TABLE IF NOT EXISTS turnos_semanas (
  Id_Semana BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Fecha_Inicio DATE NOT NULL COMMENT 'Lunes de la semana',
  Fecha_Fin DATE NOT NULL COMMENT 'Domingo de la semana',
  Estado ENUM('borrador', 'publicado', 'pendiente_republicacion') NOT NULL DEFAULT 'borrador',
  Publicado_Por BIGINT UNSIGNED NULL,
  Fecha_Ultima_Publicacion DATETIME NULL,
  Creado_Por BIGINT UNSIGNED NULL,
  Actualizado_Por BIGINT UNSIGNED NULL,
  Fecha_Creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Fecha_Actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id_Semana),
  UNIQUE KEY ux_turnos_semanas_inicio (Fecha_Inicio),
  CONSTRAINT fk_turnos_semanas_publicado_por FOREIGN KEY (Publicado_Por)
    REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_turnos_semanas_creado_por FOREIGN KEY (Creado_Por)
    REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_turnos_semanas_actualizado_por FOREIGN KEY (Actualizado_Por)
    REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La jornada de un asesor para un día concreto dentro de una semana.
-- Es_Supernumerario marca, dentro de esa semana, quién cubre huecos del
-- canal (puede rotar entre compañeros; no es un atributo fijo del perfil).
CREATE TABLE IF NOT EXISTS turnos_dias (
  Id_Turno_Dia BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Semana BIGINT UNSIGNED NOT NULL,
  Id_Usuario BIGINT UNSIGNED NOT NULL,
  Fecha DATE NOT NULL,
  Dia_Semana TINYINT UNSIGNED NOT NULL COMMENT '1=lunes, 7=domingo',
  Es_Laborable TINYINT(1) NOT NULL DEFAULT 0,
  Hora_Inicio TIME NULL,
  Hora_Fin TIME NULL,
  Es_Supernumerario TINYINT(1) NOT NULL DEFAULT 0,
  Creado_Por BIGINT UNSIGNED NULL,
  Actualizado_Por BIGINT UNSIGNED NULL,
  Fecha_Creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Fecha_Actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id_Turno_Dia),
  UNIQUE KEY ux_turnos_dias_usuario_fecha (Id_Usuario, Fecha),
  KEY idx_turnos_dias_semana (Id_Semana),
  CONSTRAINT fk_turnos_dias_semana FOREIGN KEY (Id_Semana)
    REFERENCES turnos_semanas (Id_Semana) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_turnos_dias_usuario FOREIGN KEY (Id_Usuario)
    REFERENCES usuarios (Id_Usuario) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_turnos_dias_creado_por FOREIGN KEY (Creado_Por)
    REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_turnos_dias_actualizado_por FOREIGN KEY (Actualizado_Por)
    REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_turnos_dias_dia CHECK (Dia_Semana BETWEEN 1 AND 7),
  CONSTRAINT chk_turnos_dias_horas CHECK (
    (Es_Laborable = 0 AND Hora_Inicio IS NULL AND Hora_Fin IS NULL)
    OR
    (Es_Laborable = 1 AND Hora_Inicio IS NOT NULL AND Hora_Fin IS NOT NULL
      AND Hora_Inicio < Hora_Fin AND Hora_Fin <= '23:00:00')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
