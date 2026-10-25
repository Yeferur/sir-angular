-- Pendientes persistentes para corregir operaciones separadas de una entidad rechazada.
INSERT INTO reglas_pendientes
  (Codigo, Nombre, Descripcion, Activa, Prioridad_Default, Recurrencia_Minutos,
   Permite_Descarte, Requiere_Justificacion, Posposicion_Max_Minutos, Configuracion)
VALUES
  ('ENTIDAD_REPORTANTE_RECHAZADA_SIN_REASIGNAR', 'Operaciones sin entidad reportante',
   'Asigna una entidad válida a las operaciones afectadas por un rechazo.',
   1, 'ALTA', NULL, 0, 0, NULL, JSON_OBJECT())
ON DUPLICATE KEY UPDATE
  Nombre=VALUES(Nombre), Descripcion=VALUES(Descripcion), Activa=VALUES(Activa),
  Prioridad_Default=VALUES(Prioridad_Default), Recurrencia_Minutos=VALUES(Recurrencia_Minutos),
  Permite_Descarte=VALUES(Permite_Descarte), Requiere_Justificacion=VALUES(Requiere_Justificacion),
  Posposicion_Max_Minutos=VALUES(Posposicion_Max_Minutos), Configuracion=VALUES(Configuracion);
