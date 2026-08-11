-- Planificacion semanal compacta: el canal puede variar por semana y las
-- vacaciones se gestionan como periodos independientes del horario diario.

CREATE TABLE IF NOT EXISTS turnos_asesores_semana (
  Id_Asignacion BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Semana BIGINT UNSIGNED NOT NULL,
  Id_Usuario BIGINT UNSIGNED NOT NULL,
  Id_Canal BIGINT UNSIGNED NULL,
  Es_Supernumerario TINYINT(1) NOT NULL DEFAULT 0,
  Creado_Por BIGINT UNSIGNED NULL,
  Actualizado_Por BIGINT UNSIGNED NULL,
  Fecha_Creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Fecha_Actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id_Asignacion),
  UNIQUE KEY ux_turnos_asesor_semana (Id_Semana, Id_Usuario),
  KEY idx_turnos_asesor_semana_usuario (Id_Usuario),
  CONSTRAINT fk_turnos_as_semana FOREIGN KEY (Id_Semana)
    REFERENCES turnos_semanas (Id_Semana) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_turnos_as_usuario FOREIGN KEY (Id_Usuario)
    REFERENCES usuarios (Id_Usuario) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_turnos_as_canal FOREIGN KEY (Id_Canal)
    REFERENCES canales_turno (Id_Canal) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_turnos_as_creado FOREIGN KEY (Creado_Por)
    REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_turnos_as_actualizado FOREIGN KEY (Actualizado_Por)
    REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO turnos_asesores_semana (Id_Semana, Id_Usuario, Id_Canal, Es_Supernumerario)
SELECT td.Id_Semana, td.Id_Usuario, u.Id_Canal, MAX(td.Es_Supernumerario)
FROM turnos_dias td
INNER JOIN usuarios u ON u.Id_Usuario = td.Id_Usuario
GROUP BY td.Id_Semana, td.Id_Usuario, u.Id_Canal
ON DUPLICATE KEY UPDATE
  Es_Supernumerario = VALUES(Es_Supernumerario);

CREATE TABLE IF NOT EXISTS turnos_vacaciones (
  Id_Vacacion BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Usuario BIGINT UNSIGNED NOT NULL,
  Fecha_Inicio DATE NOT NULL COMMENT 'Primer dia de disfrute',
  Fecha_Fin DATE NOT NULL COMMENT 'Ultimo dia de disfrute',
  Fecha_Regreso DATE NOT NULL COMMENT 'Fecha prevista de reincorporacion',
  Dias_Habiles SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  Estado ENUM('programada', 'cancelada') NOT NULL DEFAULT 'programada',
  Observaciones VARCHAR(500) NULL,
  Creado_Por BIGINT UNSIGNED NULL,
  Actualizado_Por BIGINT UNSIGNED NULL,
  Fecha_Creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Fecha_Actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id_Vacacion),
  KEY idx_turnos_vacaciones_usuario_fechas (Id_Usuario, Fecha_Inicio, Fecha_Fin),
  CONSTRAINT fk_turnos_vac_usuario FOREIGN KEY (Id_Usuario)
    REFERENCES usuarios (Id_Usuario) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_turnos_vac_creado FOREIGN KEY (Creado_Por)
    REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_turnos_vac_actualizado FOREIGN KEY (Actualizado_Por)
    REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_turnos_vac_fechas CHECK (
    Fecha_Inicio <= Fecha_Fin AND Fecha_Regreso > Fecha_Fin AND Dias_Habiles > 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
