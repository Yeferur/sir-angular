-- Base del MVP de Pendientes y Recordatorios.
-- Los pendientes automáticos no son tareas asignables: el destinatario se
-- calcula por la regla que detecta la situación operativa.

CREATE TABLE IF NOT EXISTS reglas_pendientes (
  Id_Regla bigint unsigned NOT NULL AUTO_INCREMENT,
  Codigo varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  Nombre varchar(160) COLLATE utf8mb4_unicode_ci NOT NULL,
  Descripcion varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  Activa tinyint(1) NOT NULL DEFAULT 1,
  Prioridad_Default enum('BAJA','MEDIA','ALTA','CRITICA') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MEDIA',
  Recurrencia_Minutos int unsigned DEFAULT NULL,
  Permite_Descarte tinyint(1) NOT NULL DEFAULT 1,
  Requiere_Justificacion tinyint(1) NOT NULL DEFAULT 0,
  Posposicion_Max_Minutos int unsigned DEFAULT NULL,
  Ventanas_Urgencia json DEFAULT NULL,
  Configuracion json DEFAULT NULL,
  Fecha_Creacion datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Fecha_Actualizacion datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id_Regla),
  UNIQUE KEY uq_reglas_pendientes_codigo (Codigo),
  CONSTRAINT chk_reglas_pendientes_recurrencia CHECK (Recurrencia_Minutos IS NULL OR Recurrencia_Minutos > 0),
  CONSTRAINT chk_reglas_pendientes_posposicion CHECK (Posposicion_Max_Minutos IS NULL OR Posposicion_Max_Minutos > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pendientes_operativos (
  Id_Pendiente bigint unsigned NOT NULL AUTO_INCREMENT,
  Id_Regla bigint unsigned NOT NULL,
  Clave_Deduplicacion varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  Entidad_Tipo varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  Entidad_Id varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  Id_Usuario_Destino bigint unsigned DEFAULT NULL,
  Permiso_Audiencia varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  Titulo varchar(160) COLLATE utf8mb4_unicode_ci NOT NULL,
  Descripcion varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  Prioridad enum('BAJA','MEDIA','ALTA','CRITICA') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MEDIA',
  Estado enum('ACTIVO','RESUELTO_AUTOMATICAMENTE','DESCARTADO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVO',
  Fecha_Operacion datetime DEFAULT NULL,
  Fecha_Limite datetime DEFAULT NULL,
  Suprimido_Hasta datetime DEFAULT NULL,
  Siguiente_Recordatorio datetime DEFAULT NULL,
  Motivo_Descarte varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  Descartado_Por bigint unsigned DEFAULT NULL,
  Fecha_Descarte datetime DEFAULT NULL,
  Primera_Deteccion datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Ultima_Deteccion datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Fecha_Resolucion datetime DEFAULT NULL,
  Datos json DEFAULT NULL,
  Fecha_Creacion datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  Fecha_Actualizacion datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (Id_Pendiente),
  UNIQUE KEY uq_pendientes_clave (Clave_Deduplicacion),
  KEY idx_pendientes_usuario_estado (Id_Usuario_Destino, Estado, Suprimido_Hasta),
  KEY idx_pendientes_audiencia_estado (Permiso_Audiencia, Estado, Suprimido_Hasta),
  KEY idx_pendientes_entidad (Entidad_Tipo, Entidad_Id),
  KEY idx_pendientes_recordatorio (Estado, Siguiente_Recordatorio),
  CONSTRAINT fk_pendientes_regla FOREIGN KEY (Id_Regla) REFERENCES reglas_pendientes (Id_Regla) ON UPDATE CASCADE,
  CONSTRAINT fk_pendientes_usuario_destino FOREIGN KEY (Id_Usuario_Destino) REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_pendientes_descartado_por FOREIGN KEY (Descartado_Por) REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pendientes_eventos (
  Id_Evento bigint unsigned NOT NULL AUTO_INCREMENT,
  Id_Pendiente bigint unsigned NOT NULL,
  Tipo enum('DETECTADO','REACTIVADO','POSPUESTO','DESCARTADO','RESUELTO_AUTOMATICAMENTE') COLLATE utf8mb4_unicode_ci NOT NULL,
  Id_Usuario bigint unsigned DEFAULT NULL,
  Motivo varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  Datos json DEFAULT NULL,
  Fecha_Creacion datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (Id_Evento),
  KEY idx_pendientes_eventos_pendiente (Id_Pendiente, Fecha_Creacion),
  CONSTRAINT fk_pendientes_eventos_pendiente FOREIGN KEY (Id_Pendiente) REFERENCES pendientes_operativos (Id_Pendiente) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pendientes_eventos_usuario FOREIGN KEY (Id_Usuario) REFERENCES usuarios (Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE recordatorios
  MODIFY COLUMN Titulo varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN Fecha datetime NOT NULL;

DROP PROCEDURE IF EXISTS migrate_recordatorios_mvp;
DELIMITER //
CREATE PROCEDURE migrate_recordatorios_mvp()
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recordatorios' AND COLUMN_NAME = 'Estado') THEN
    ALTER TABLE recordatorios ADD COLUMN Estado enum('ACTIVO','COMPLETADO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVO' AFTER Siguiente_Trigger;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recordatorios' AND COLUMN_NAME = 'Suprimido_Hasta') THEN
    ALTER TABLE recordatorios ADD COLUMN Suprimido_Hasta datetime DEFAULT NULL AFTER Estado;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recordatorios' AND COLUMN_NAME = 'Entidad_Tipo') THEN
    ALTER TABLE recordatorios ADD COLUMN Entidad_Tipo varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER Suprimido_Hasta;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recordatorios' AND COLUMN_NAME = 'Entidad_Id') THEN
    ALTER TABLE recordatorios ADD COLUMN Entidad_Id varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER Entidad_Tipo;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recordatorios' AND COLUMN_NAME = 'Fecha_Creacion') THEN
    ALTER TABLE recordatorios ADD COLUMN Fecha_Creacion datetime NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER Activo;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recordatorios' AND COLUMN_NAME = 'Fecha_Actualizacion') THEN
    ALTER TABLE recordatorios ADD COLUMN Fecha_Actualizacion datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER Fecha_Creacion;
  END IF;
END//
DELIMITER ;
CALL migrate_recordatorios_mvp();
DROP PROCEDURE migrate_recordatorios_mvp;

SET @sql_recordatorios_usuario = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recordatorios' AND INDEX_NAME = 'idx_recordatorios_usuario_estado'),
  'DO 0',
  'ALTER TABLE recordatorios ADD INDEX idx_recordatorios_usuario_estado (Id_Usuario, Estado, Fecha)'
);
PREPARE stmt_recordatorios_usuario FROM @sql_recordatorios_usuario;
EXECUTE stmt_recordatorios_usuario;
DEALLOCATE PREPARE stmt_recordatorios_usuario;

SET @sql_recordatorios_trigger = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recordatorios' AND INDEX_NAME = 'idx_recordatorios_trigger'),
  'DO 0',
  'ALTER TABLE recordatorios ADD INDEX idx_recordatorios_trigger (Estado, Siguiente_Trigger)'
);
PREPARE stmt_recordatorios_trigger FROM @sql_recordatorios_trigger;
EXECUTE stmt_recordatorios_trigger;
DEALLOCATE PREPARE stmt_recordatorios_trigger;

INSERT INTO permisos (Accion, Codigo_Permiso, Descripcion, Modulo_Permiso)
VALUES
  ('LEER', 'PENDIENTES.LEER', 'Consultar pendientes operativos propios o visibles por regla', 'Pendientes'),
  ('GESTIONAR', 'PENDIENTES.GESTIONAR', 'Posponer o descartar pendientes según su regla', 'Pendientes'),
  ('AUDITAR', 'PENDIENTES.AUDITAR', 'Consultar trazabilidad administrativa de pendientes', 'Pendientes'),
  ('LEER', 'RECORDATORIOS.LEER', 'Consultar recordatorios personales', 'Recordatorios'),
  ('CREAR', 'RECORDATORIOS.CREAR', 'Crear recordatorios personales', 'Recordatorios'),
  ('ACTUALIZAR', 'RECORDATORIOS.ACTUALIZAR', 'Actualizar recordatorios personales', 'Recordatorios'),
  ('ELIMINAR', 'RECORDATORIOS.ELIMINAR', 'Eliminar recordatorios personales', 'Recordatorios')
ON DUPLICATE KEY UPDATE
  Accion = VALUES(Accion),
  Descripcion = VALUES(Descripcion),
  Modulo_Permiso = VALUES(Modulo_Permiso);

INSERT IGNORE INTO rol_permisos (Id_Rol, Id_Permiso)
SELECT r.Id_Rol, p.Id_Permiso
FROM roles r
INNER JOIN permisos p ON p.Codigo_Permiso IN (
  'PENDIENTES.LEER', 'PENDIENTES.GESTIONAR',
  'RECORDATORIOS.LEER', 'RECORDATORIOS.CREAR',
  'RECORDATORIOS.ACTUALIZAR', 'RECORDATORIOS.ELIMINAR'
)
WHERE LOWER(TRIM(r.Nombre_Rol)) IN ('administrador', 'asesor');

INSERT IGNORE INTO rol_permisos (Id_Rol, Id_Permiso)
SELECT r.Id_Rol, p.Id_Permiso
FROM roles r
INNER JOIN permisos p ON p.Codigo_Permiso = 'PENDIENTES.AUDITAR'
WHERE LOWER(TRIM(r.Nombre_Rol)) = 'administrador';

-- La política vive en datos. Los detectores sólo reportan la condición;
-- no deciden ventanas, recurrencia ni capacidad de descarte.
INSERT INTO reglas_pendientes
  (Codigo, Nombre, Descripcion, Prioridad_Default, Recurrencia_Minutos,
   Permite_Descarte, Requiere_Justificacion, Posposicion_Max_Minutos,
   Ventanas_Urgencia, Configuracion)
VALUES
  ('CONTROL_VIAJE_CIERRE_PENDIENTE', 'Cierre de control de viaje pendiente',
   'La operación conserva un cierre de control de viaje pendiente.', 'ALTA', 120, 0, 1, 60,
   JSON_ARRAY(JSON_OBJECT('minutosRestantes', 240, 'prioridad', 'ALTA'), JSON_OBJECT('minutosRestantes', 60, 'prioridad', 'CRITICA')),
   JSON_OBJECT('canales', JSON_ARRAY('CENTRO', 'INICIO', 'BADGE', 'NOTIFICACION'))),
  ('PROGRAMACION_NO_ACTIVA', 'Programación no activa',
   'Existe una programación operativa que todavía no está activa.', 'ALTA', 180, 1, 1, 120,
   JSON_ARRAY(JSON_OBJECT('minutosRestantes', 360, 'prioridad', 'ALTA'), JSON_OBJECT('minutosRestantes', 120, 'prioridad', 'CRITICA')),
   JSON_OBJECT('canales', JSON_ARRAY('CENTRO', 'INICIO', 'BADGE', 'NOTIFICACION'))),
  ('SEGUROS_INCOMPLETOS', 'Seguros incompletos',
   'La operación tiene información de seguros sin completar.', 'ALTA', 120, 0, 1, 60,
   JSON_ARRAY(JSON_OBJECT('minutosRestantes', 360, 'prioridad', 'ALTA'), JSON_OBJECT('minutosRestantes', 120, 'prioridad', 'CRITICA')),
   JSON_OBJECT('canales', JSON_ARRAY('CENTRO', 'INICIO', 'BADGE', 'NOTIFICACION'))),
  ('COMISIONES_PENDIENTES', 'Comisiones pendientes',
   'La operación conserva comisiones pendientes de revisión.', 'MEDIA', 360, 1, 1, 240,
   JSON_ARRAY(JSON_OBJECT('minutosRestantes', 1440, 'prioridad', 'MEDIA'), JSON_OBJECT('minutosRestantes', 240, 'prioridad', 'ALTA')),
   JSON_OBJECT('canales', JSON_ARRAY('CENTRO', 'INICIO', 'NOTIFICACION'))),
  ('RESERVA_ESTADO_PENDIENTE', 'Reserva que requiere atención',
   'El estado calculado por Reservas indica que el proceso sigue incompleto.', 'ALTA', 180, 0, 1, 120,
   JSON_ARRAY(JSON_OBJECT('minutosRestantes', 2880, 'prioridad', 'ALTA'), JSON_OBJECT('minutosRestantes', 720, 'prioridad', 'CRITICA')),
   JSON_OBJECT('diasAnticipacion', 30, 'canales', JSON_ARRAY('CENTRO', 'INICIO', 'BADGE', 'NOTIFICACION'))),
  ('TRANSFER_ESTADO_PENDIENTE', 'Transfer que requiere atención',
   'El estado calculado por Transfers indica que el proceso sigue incompleto.', 'ALTA', 120, 0, 1, 90,
   JSON_ARRAY(JSON_OBJECT('minutosRestantes', 1440, 'prioridad', 'ALTA'), JSON_OBJECT('minutosRestantes', 360, 'prioridad', 'CRITICA')),
   JSON_OBJECT('diasAnticipacion', 30, 'canales', JSON_ARRAY('CENTRO', 'INICIO', 'BADGE', 'NOTIFICACION')))
ON DUPLICATE KEY UPDATE
  Nombre = VALUES(Nombre),
  Descripcion = VALUES(Descripcion),
  Prioridad_Default = VALUES(Prioridad_Default),
  Recurrencia_Minutos = VALUES(Recurrencia_Minutos),
  Permite_Descarte = VALUES(Permite_Descarte),
  Requiere_Justificacion = VALUES(Requiere_Justificacion),
  Posposicion_Max_Minutos = VALUES(Posposicion_Max_Minutos),
  Ventanas_Urgencia = VALUES(Ventanas_Urgencia),
  Configuracion = VALUES(Configuracion);
