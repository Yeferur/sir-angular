-- El rechazo elimina la entidad, pero las operaciones cerradas y los lotes
-- históricos conservan su Id_Entidad_Reportante sin modificar sus filas.
-- Estas referencias dejan de validar contra el catálogo borrado; el historial
-- textual del rechazo conserva el nombre de la entidad.
SET @sql_reservas_entidad_fk = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='reservas'
      AND CONSTRAINT_NAME='fk_reservas_entidad_reportante'),
  'ALTER TABLE reservas DROP FOREIGN KEY fk_reservas_entidad_reportante',
  'DO 0'
);
PREPARE stmt_reservas_entidad_fk FROM @sql_reservas_entidad_fk;
EXECUTE stmt_reservas_entidad_fk;
DEALLOCATE PREPARE stmt_reservas_entidad_fk;

SET @sql_transfers_entidad_fk = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='transfers'
      AND CONSTRAINT_NAME='fk_transfers_entidad_reportante'),
  'ALTER TABLE transfers DROP FOREIGN KEY fk_transfers_entidad_reportante',
  'DO 0'
);
PREPARE stmt_transfers_entidad_fk FROM @sql_transfers_entidad_fk;
EXECUTE stmt_transfers_entidad_fk;
DEALLOCATE PREPARE stmt_transfers_entidad_fk;

SET @sql_comisiones_grupo_entidad_fk = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='comisiones_grupos_pago'
      AND CONSTRAINT_NAME='fk_comisiones_grupo_entidad'),
  'ALTER TABLE comisiones_grupos_pago DROP FOREIGN KEY fk_comisiones_grupo_entidad',
  'DO 0'
);
PREPARE stmt_comisiones_grupo_entidad_fk FROM @sql_comisiones_grupo_entidad_fk;
EXECUTE stmt_comisiones_grupo_entidad_fk;
DEALLOCATE PREPARE stmt_comisiones_grupo_entidad_fk;
