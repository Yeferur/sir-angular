SET @sql_app_updates_column = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notificaciones'
            AND COLUMN_NAME = 'Clave_Deduplicacion'),
  'DO 0',
  'ALTER TABLE notificaciones ADD COLUMN Clave_Deduplicacion varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER Datos'
);
PREPARE stmt_app_updates_column FROM @sql_app_updates_column;
EXECUTE stmt_app_updates_column;
DEALLOCATE PREPARE stmt_app_updates_column;

SET @sql_app_updates_index = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notificaciones'
            AND INDEX_NAME = 'uq_notificaciones_usuario_deduplicacion'),
  'DO 0',
  'ALTER TABLE notificaciones ADD UNIQUE KEY uq_notificaciones_usuario_deduplicacion (Id_Usuario, Clave_Deduplicacion)'
);
PREPARE stmt_app_updates_index FROM @sql_app_updates_index;
EXECUTE stmt_app_updates_index;
DEALLOCATE PREPARE stmt_app_updates_index;
