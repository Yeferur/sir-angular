-- Regla para avisos persistidos de cambios posteriores a una programación guardada.
-- Reutiliza la estructura existente de Pendientes; no crea tablas ni permisos.
INSERT INTO reglas_pendientes
  (Codigo, Nombre, Descripcion, Activa, Prioridad_Default, Recurrencia_Minutos,
   Permite_Descarte, Requiere_Justificacion, Posposicion_Max_Minutos,
   Ventanas_Urgencia, Configuracion)
VALUES
  ('PROGRAMACION_CAMBIOS_OPERATIVOS', 'Cambios después de guardar la programación',
   'Una reserva grupal o privada cambió después de guardar su programación.',
   1, 'ALTA', NULL, 1, 0, NULL,
   '[{"prioridad":"ALTA","minutosRestantes":2880},{"prioridad":"CRITICA","minutosRestantes":360}]',
   '{"canales":["CENTRO","INICIO","BADGE","NOTIFICACION"]}')
-- Una repetición conserva cualquier fila existente. Antes de aplicar, verificar
-- que un código preexistente tenga los valores esperados; nunca se sobrescribe.
ON DUPLICATE KEY UPDATE
  Codigo = VALUES(Codigo);
