-- Ensure the transfer channel and reporting-entity links exist before 0016 indexes them.
SET @sql_transfers_canal_col = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='transfers' AND COLUMN_NAME='Id_Canal'),
  'DO 0',
  'ALTER TABLE transfers ADD COLUMN Id_Canal BIGINT UNSIGNED NULL'
);
PREPARE stmt_transfers_canal_col FROM @sql_transfers_canal_col;
EXECUTE stmt_transfers_canal_col;
DEALLOCATE PREPARE stmt_transfers_canal_col;

SET @sql_transfers_entidad_col = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='transfers' AND COLUMN_NAME='Id_Entidad_Reportante'),
  'DO 0',
  'ALTER TABLE transfers ADD COLUMN Id_Entidad_Reportante BIGINT UNSIGNED NULL'
);
PREPARE stmt_transfers_entidad_col FROM @sql_transfers_entidad_col;
EXECUTE stmt_transfers_entidad_col;
DEALLOCATE PREPARE stmt_transfers_entidad_col;

SET @sql_transfers_canal_fk = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND TABLE_NAME='transfers' AND CONSTRAINT_NAME='fk_transfers_canal'),
  'DO 0',
  'ALTER TABLE transfers ADD CONSTRAINT fk_transfers_canal FOREIGN KEY (Id_Canal) REFERENCES canales_reservas(Id_Canal) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE stmt_transfers_canal_fk FROM @sql_transfers_canal_fk;
EXECUTE stmt_transfers_canal_fk;
DEALLOCATE PREPARE stmt_transfers_canal_fk;

SET @sql_transfers_entidad_fk = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND TABLE_NAME='transfers' AND CONSTRAINT_NAME='fk_transfers_entidad_reportante'),
  'DO 0',
  'ALTER TABLE transfers ADD CONSTRAINT fk_transfers_entidad_reportante FOREIGN KEY (Id_Entidad_Reportante) REFERENCES entidades_reportantes(Id_Entidad_Reportante) ON DELETE RESTRICT ON UPDATE CASCADE'
);
PREPARE stmt_transfers_entidad_fk FROM @sql_transfers_entidad_fk;
EXECUTE stmt_transfers_entidad_fk;
DEALLOCATE PREPARE stmt_transfers_entidad_fk;
