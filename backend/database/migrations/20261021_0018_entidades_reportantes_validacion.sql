-- Señala las operaciones cuya revisión quedó pendiente por el rechazo
-- de la entidad reportante. Ambas columnas son aditivas y empiezan en NULL.
SET @sql_reserva_entidad_pendiente = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='reservas' AND COLUMN_NAME='Pendiente_Por_Entidad_En'),
  'DO 0',
  'ALTER TABLE reservas ADD COLUMN Pendiente_Por_Entidad_En DATETIME(3) NULL'
);
PREPARE stmt_reserva_entidad_pendiente FROM @sql_reserva_entidad_pendiente;
EXECUTE stmt_reserva_entidad_pendiente;
DEALLOCATE PREPARE stmt_reserva_entidad_pendiente;

SET @sql_transfer_entidad_pendiente = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='transfers' AND COLUMN_NAME='Pendiente_Por_Entidad_En'),
  'DO 0',
  'ALTER TABLE transfers ADD COLUMN Pendiente_Por_Entidad_En DATETIME(3) NULL'
);
PREPARE stmt_transfer_entidad_pendiente FROM @sql_transfer_entidad_pendiente;
EXECUTE stmt_transfer_entidad_pendiente;
DEALLOCATE PREPARE stmt_transfer_entidad_pendiente;

INSERT INTO reglas_pendientes
  (Codigo, Nombre, Descripcion, Activa, Prioridad_Default, Recurrencia_Minutos,
   Permite_Descarte, Requiere_Justificacion, Posposicion_Max_Minutos, Configuracion)
VALUES
  ('ENTIDAD_REPORTANTE_PENDIENTE_VALIDACION', 'Entidad reportante pendiente de validación',
   'Una entidad reportante requiere revisión de una persona con permiso para validar entidades.',
   1, 'MEDIA', NULL, 0, 0, NULL, JSON_OBJECT())
ON DUPLICATE KEY UPDATE
  Nombre=VALUES(Nombre), Descripcion=VALUES(Descripcion), Activa=VALUES(Activa),
  Prioridad_Default=VALUES(Prioridad_Default), Recurrencia_Minutos=VALUES(Recurrencia_Minutos),
  Permite_Descarte=VALUES(Permite_Descarte), Requiere_Justificacion=VALUES(Requiere_Justificacion),
  Posposicion_Max_Minutos=VALUES(Posposicion_Max_Minutos), Configuracion=VALUES(Configuracion);
