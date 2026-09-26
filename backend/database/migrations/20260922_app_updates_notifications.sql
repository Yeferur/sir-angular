ALTER TABLE notificaciones
  ADD COLUMN Clave_Deduplicacion varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER Datos,
  ADD UNIQUE KEY uq_notificaciones_usuario_deduplicacion (Id_Usuario, Clave_Deduplicacion);
