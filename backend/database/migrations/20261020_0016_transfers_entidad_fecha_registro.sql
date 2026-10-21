-- Supports historical and period activity grouped by reporting entity.
SET @sql_transfers_entidad_registro_idx = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='transfers' AND INDEX_NAME='ix_transfers_entidad_registro'),
  'DO 0',
  'ALTER TABLE transfers ADD INDEX ix_transfers_entidad_registro (Id_Entidad_Reportante, Fecha_Registro)'
);
PREPARE stmt_transfers_entidad_registro_idx FROM @sql_transfers_entidad_registro_idx;
EXECUTE stmt_transfers_entidad_registro_idx;
DEALLOCATE PREPARE stmt_transfers_entidad_registro_idx;
