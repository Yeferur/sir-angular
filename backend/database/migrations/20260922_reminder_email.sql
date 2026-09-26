-- Correo opcional por recordatorio personal.
-- Los registros existentes conservan el comportamiento interno porque el valor
-- predeterminado es 0. El enum se amplía sin retirar tipos existentes.

SET @sql_reminder_preference = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recordatorios' AND COLUMN_NAME = 'Enviar_Correo'
  ),
  'DO 0',
  'ALTER TABLE recordatorios ADD COLUMN Enviar_Correo tinyint(1) NOT NULL DEFAULT 0 AFTER Intervalo_Todo_El_Dia'
);
PREPARE stmt_reminder_preference FROM @sql_reminder_preference;
EXECUTE stmt_reminder_preference;
DEALLOCATE PREPARE stmt_reminder_preference;

SET @sql_reminder_outbox_type = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_outbox' AND COLUMN_NAME = 'Tipo'
       AND COLUMN_TYPE LIKE '%''reminder''%'
  ),
  'DO 0',
  'ALTER TABLE email_outbox MODIFY COLUMN Tipo enum(''password_reset'',''schedule'',''reminder'') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL'
);
PREPARE stmt_reminder_outbox_type FROM @sql_reminder_outbox_type;
EXECUTE stmt_reminder_outbox_type;
DEALLOCATE PREPARE stmt_reminder_outbox_type;

SET @sql_reminder_dispatch_type = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_outbox_dispatches' AND COLUMN_NAME = 'Tipo'
       AND COLUMN_TYPE LIKE '%''reminder''%'
  ),
  'DO 0',
  'ALTER TABLE email_outbox_dispatches MODIFY COLUMN Tipo enum(''password_reset'',''schedule'',''reminder'') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL'
);
PREPARE stmt_reminder_dispatch_type FROM @sql_reminder_dispatch_type;
EXECUTE stmt_reminder_dispatch_type;
DEALLOCATE PREPARE stmt_reminder_dispatch_type;
