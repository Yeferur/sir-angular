-- Jornadas laborales semanales para usuarios con rol Asesor.
-- Los horarios de salida de tours permanecen en `horarios`; este dominio es independiente.

CREATE TABLE IF NOT EXISTS turnos_asesores (
  Id_Turno BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  Id_Usuario BIGINT UNSIGNED NOT NULL,
  Dia_Semana TINYINT UNSIGNED NOT NULL COMMENT '1=lunes, 7=domingo',
  Es_Laborable TINYINT(1) NOT NULL DEFAULT 0,
  Hora_Inicio TIME NULL,
  Hora_Fin TIME NULL,
  Creado_Por BIGINT UNSIGNED NULL,
  Actualizado_Por BIGINT UNSIGNED NULL,
  Fecha_Creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Fecha_Actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id_Turno),
  UNIQUE KEY ux_turnos_asesores_usuario_dia (Id_Usuario, Dia_Semana),
  KEY idx_turnos_asesores_dia_horas (Dia_Semana, Es_Laborable, Hora_Inicio, Hora_Fin),
  KEY idx_turnos_asesores_creado_por (Creado_Por),
  KEY idx_turnos_asesores_actualizado_por (Actualizado_Por),
  CONSTRAINT fk_turnos_asesores_usuario
    FOREIGN KEY (Id_Usuario) REFERENCES usuarios (Id_Usuario)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_turnos_asesores_creado_por
    FOREIGN KEY (Creado_Por) REFERENCES usuarios (Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_turnos_asesores_actualizado_por
    FOREIGN KEY (Actualizado_Por) REFERENCES usuarios (Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_turnos_asesores_dia CHECK (Dia_Semana BETWEEN 1 AND 7),
  CONSTRAINT chk_turnos_asesores_horas CHECK (
    (Es_Laborable = 0 AND Hora_Inicio IS NULL AND Hora_Fin IS NULL)
    OR
    (Es_Laborable = 1 AND Hora_Inicio IS NOT NULL AND Hora_Fin IS NOT NULL
      AND Hora_Inicio < Hora_Fin AND Hora_Fin <= '23:00:00')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO permisos (Accion, Codigo_Permiso, Descripcion, Modulo_Permiso)
VALUES
  ('LEER', 'TURNOS.LEER', 'Ver las jornadas de los asesores', 'Turnos'),
  ('ACTUALIZAR', 'TURNOS.ACTUALIZAR', 'Configurar las jornadas de los asesores', 'Turnos')
ON DUPLICATE KEY UPDATE
  Accion = VALUES(Accion),
  Descripcion = VALUES(Descripcion),
  Modulo_Permiso = VALUES(Modulo_Permiso);

-- Mantiene el alcance administrativo actual del módulo de usuarios.
INSERT IGNORE INTO rol_permisos (Id_Rol, Id_Permiso)
SELECT rp.Id_Rol, nuevo.Id_Permiso
FROM rol_permisos rp
INNER JOIN permisos anterior ON anterior.Id_Permiso = rp.Id_Permiso
INNER JOIN permisos nuevo ON nuevo.Codigo_Permiso = 'TURNOS.LEER'
WHERE anterior.Codigo_Permiso = 'USUARIOS.LEER';

INSERT IGNORE INTO rol_permisos (Id_Rol, Id_Permiso)
SELECT rp.Id_Rol, nuevo.Id_Permiso
FROM rol_permisos rp
INNER JOIN permisos anterior ON anterior.Id_Permiso = rp.Id_Permiso
INNER JOIN permisos nuevo ON nuevo.Codigo_Permiso = 'TURNOS.ACTUALIZAR'
WHERE anterior.Codigo_Permiso = 'USUARIOS.ACTUALIZAR';
