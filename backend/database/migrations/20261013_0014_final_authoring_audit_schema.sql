-- Final authoring and audit persistence for the current SIR2 release.
-- Guards keep this migration safe when schema changes were applied manually.

SET @sql_tours_creado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='tours' AND COLUMN_NAME='Creado_Por'),
  'DO 0',
  'ALTER TABLE tours ADD COLUMN Creado_Por BIGINT UNSIGNED NULL AFTER Activo'
);
PREPARE stmt_tours_creado_por FROM @sql_tours_creado_por;
EXECUTE stmt_tours_creado_por;
DEALLOCATE PREPARE stmt_tours_creado_por;

SET @sql_tours_actualizado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='tours' AND COLUMN_NAME='Actualizado_Por'),
  'DO 0',
  'ALTER TABLE tours ADD COLUMN Actualizado_Por BIGINT UNSIGNED NULL AFTER Creado_Por'
);
PREPARE stmt_tours_actualizado_por FROM @sql_tours_actualizado_por;
EXECUTE stmt_tours_actualizado_por;
DEALLOCATE PREPARE stmt_tours_actualizado_por;

SET @sql_puntos_creado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='puntos' AND COLUMN_NAME='Creado_Por'),
  'DO 0',
  'ALTER TABLE puntos ADD COLUMN Creado_Por BIGINT UNSIGNED NULL AFTER Activo'
);
PREPARE stmt_puntos_creado_por FROM @sql_puntos_creado_por;
EXECUTE stmt_puntos_creado_por;
DEALLOCATE PREPARE stmt_puntos_creado_por;

SET @sql_puntos_actualizado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='puntos' AND COLUMN_NAME='Actualizado_Por'),
  'DO 0',
  'ALTER TABLE puntos ADD COLUMN Actualizado_Por BIGINT UNSIGNED NULL AFTER Creado_Por'
);
PREPARE stmt_puntos_actualizado_por FROM @sql_puntos_actualizado_por;
EXECUTE stmt_puntos_actualizado_por;
DEALLOCATE PREPARE stmt_puntos_actualizado_por;

SET @sql_liquidaciones_creado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='liquidaciones' AND COLUMN_NAME='Creado_Por'),
  'DO 0',
  'ALTER TABLE liquidaciones ADD COLUMN Creado_Por BIGINT UNSIGNED NULL AFTER Fecha_Registro'
);
PREPARE stmt_liquidaciones_creado_por FROM @sql_liquidaciones_creado_por;
EXECUTE stmt_liquidaciones_creado_por;
DEALLOCATE PREPARE stmt_liquidaciones_creado_por;

SET @sql_liquidaciones_actualizado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='liquidaciones' AND COLUMN_NAME='Actualizado_Por'),
  'DO 0',
  'ALTER TABLE liquidaciones ADD COLUMN Actualizado_Por BIGINT UNSIGNED NULL AFTER Creado_Por'
);
PREPARE stmt_liquidaciones_actualizado_por FROM @sql_liquidaciones_actualizado_por;
EXECUTE stmt_liquidaciones_actualizado_por;
DEALLOCATE PREPARE stmt_liquidaciones_actualizado_por;

SET @sql_programaciones_creado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='programaciones' AND COLUMN_NAME='Creado_Por'),
  'DO 0',
  'ALTER TABLE programaciones ADD COLUMN Creado_Por BIGINT UNSIGNED NULL AFTER Confirmado_Por'
);
PREPARE stmt_programaciones_creado_por FROM @sql_programaciones_creado_por;
EXECUTE stmt_programaciones_creado_por;
DEALLOCATE PREPARE stmt_programaciones_creado_por;

SET @sql_historial_actor_nombre = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='historial' AND COLUMN_NAME='Actor_Nombre'),
  'DO 0',
  'ALTER TABLE historial ADD COLUMN Actor_Nombre VARCHAR(255) NULL AFTER Id_Usuario'
);
PREPARE stmt_historial_actor_nombre FROM @sql_historial_actor_nombre;
EXECUTE stmt_historial_actor_nombre;
DEALLOCATE PREPARE stmt_historial_actor_nombre;

SET @sql_historial_actor_rol = IF(
  EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='historial' AND COLUMN_NAME='Actor_Rol'),
  'DO 0',
  'ALTER TABLE historial ADD COLUMN Actor_Rol VARCHAR(100) NULL AFTER Actor_Nombre'
);
PREPARE stmt_historial_actor_rol FROM @sql_historial_actor_rol;
EXECUTE stmt_historial_actor_rol;
DEALLOCATE PREPARE stmt_historial_actor_rol;

SET @sql_idx_tours_creado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='tours' AND INDEX_NAME='ix_tours_creado_por'),
  'DO 0', 'ALTER TABLE tours ADD KEY ix_tours_creado_por (Creado_Por)'
);
PREPARE stmt_idx_tours_creado_por FROM @sql_idx_tours_creado_por;
EXECUTE stmt_idx_tours_creado_por;
DEALLOCATE PREPARE stmt_idx_tours_creado_por;

SET @sql_idx_tours_actualizado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='tours' AND INDEX_NAME='ix_tours_actualizado_por'),
  'DO 0', 'ALTER TABLE tours ADD KEY ix_tours_actualizado_por (Actualizado_Por)'
);
PREPARE stmt_idx_tours_actualizado_por FROM @sql_idx_tours_actualizado_por;
EXECUTE stmt_idx_tours_actualizado_por;
DEALLOCATE PREPARE stmt_idx_tours_actualizado_por;

SET @sql_idx_puntos_creado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='puntos' AND INDEX_NAME='ix_puntos_creado_por'),
  'DO 0', 'ALTER TABLE puntos ADD KEY ix_puntos_creado_por (Creado_Por)'
);
PREPARE stmt_idx_puntos_creado_por FROM @sql_idx_puntos_creado_por;
EXECUTE stmt_idx_puntos_creado_por;
DEALLOCATE PREPARE stmt_idx_puntos_creado_por;

SET @sql_idx_puntos_actualizado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='puntos' AND INDEX_NAME='ix_puntos_actualizado_por'),
  'DO 0', 'ALTER TABLE puntos ADD KEY ix_puntos_actualizado_por (Actualizado_Por)'
);
PREPARE stmt_idx_puntos_actualizado_por FROM @sql_idx_puntos_actualizado_por;
EXECUTE stmt_idx_puntos_actualizado_por;
DEALLOCATE PREPARE stmt_idx_puntos_actualizado_por;

SET @sql_idx_liquidaciones_creado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='liquidaciones' AND INDEX_NAME='ix_liquidaciones_creado_por'),
  'DO 0', 'ALTER TABLE liquidaciones ADD KEY ix_liquidaciones_creado_por (Creado_Por)'
);
PREPARE stmt_idx_liquidaciones_creado_por FROM @sql_idx_liquidaciones_creado_por;
EXECUTE stmt_idx_liquidaciones_creado_por;
DEALLOCATE PREPARE stmt_idx_liquidaciones_creado_por;

SET @sql_idx_liquidaciones_actualizado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='liquidaciones' AND INDEX_NAME='ix_liquidaciones_actualizado_por'),
  'DO 0', 'ALTER TABLE liquidaciones ADD KEY ix_liquidaciones_actualizado_por (Actualizado_Por)'
);
PREPARE stmt_idx_liquidaciones_actualizado_por FROM @sql_idx_liquidaciones_actualizado_por;
EXECUTE stmt_idx_liquidaciones_actualizado_por;
DEALLOCATE PREPARE stmt_idx_liquidaciones_actualizado_por;

SET @sql_idx_programaciones_creado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='programaciones' AND INDEX_NAME='ix_programaciones_creado_por'),
  'DO 0', 'ALTER TABLE programaciones ADD KEY ix_programaciones_creado_por (Creado_Por)'
);
PREPARE stmt_idx_programaciones_creado_por FROM @sql_idx_programaciones_creado_por;
EXECUTE stmt_idx_programaciones_creado_por;
DEALLOCATE PREPARE stmt_idx_programaciones_creado_por;

SET @sql_fk_tours_creado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND TABLE_NAME='tours' AND CONSTRAINT_NAME='fk_tours_creado_por'),
  'DO 0', 'ALTER TABLE tours ADD CONSTRAINT fk_tours_creado_por FOREIGN KEY (Creado_Por) REFERENCES usuarios(Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE stmt_fk_tours_creado_por FROM @sql_fk_tours_creado_por;
EXECUTE stmt_fk_tours_creado_por;
DEALLOCATE PREPARE stmt_fk_tours_creado_por;

SET @sql_fk_tours_actualizado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND TABLE_NAME='tours' AND CONSTRAINT_NAME='fk_tours_actualizado_por'),
  'DO 0', 'ALTER TABLE tours ADD CONSTRAINT fk_tours_actualizado_por FOREIGN KEY (Actualizado_Por) REFERENCES usuarios(Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE stmt_fk_tours_actualizado_por FROM @sql_fk_tours_actualizado_por;
EXECUTE stmt_fk_tours_actualizado_por;
DEALLOCATE PREPARE stmt_fk_tours_actualizado_por;

SET @sql_fk_puntos_creado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND TABLE_NAME='puntos' AND CONSTRAINT_NAME='fk_puntos_creado_por'),
  'DO 0', 'ALTER TABLE puntos ADD CONSTRAINT fk_puntos_creado_por FOREIGN KEY (Creado_Por) REFERENCES usuarios(Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE stmt_fk_puntos_creado_por FROM @sql_fk_puntos_creado_por;
EXECUTE stmt_fk_puntos_creado_por;
DEALLOCATE PREPARE stmt_fk_puntos_creado_por;

SET @sql_fk_puntos_actualizado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND TABLE_NAME='puntos' AND CONSTRAINT_NAME='fk_puntos_actualizado_por'),
  'DO 0', 'ALTER TABLE puntos ADD CONSTRAINT fk_puntos_actualizado_por FOREIGN KEY (Actualizado_Por) REFERENCES usuarios(Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE stmt_fk_puntos_actualizado_por FROM @sql_fk_puntos_actualizado_por;
EXECUTE stmt_fk_puntos_actualizado_por;
DEALLOCATE PREPARE stmt_fk_puntos_actualizado_por;

SET @sql_fk_liquidaciones_creado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND TABLE_NAME='liquidaciones' AND CONSTRAINT_NAME='fk_liquidaciones_creado_por'),
  'DO 0', 'ALTER TABLE liquidaciones ADD CONSTRAINT fk_liquidaciones_creado_por FOREIGN KEY (Creado_Por) REFERENCES usuarios(Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE stmt_fk_liquidaciones_creado_por FROM @sql_fk_liquidaciones_creado_por;
EXECUTE stmt_fk_liquidaciones_creado_por;
DEALLOCATE PREPARE stmt_fk_liquidaciones_creado_por;

SET @sql_fk_liquidaciones_actualizado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND TABLE_NAME='liquidaciones' AND CONSTRAINT_NAME='fk_liquidaciones_actualizado_por'),
  'DO 0', 'ALTER TABLE liquidaciones ADD CONSTRAINT fk_liquidaciones_actualizado_por FOREIGN KEY (Actualizado_Por) REFERENCES usuarios(Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE stmt_fk_liquidaciones_actualizado_por FROM @sql_fk_liquidaciones_actualizado_por;
EXECUTE stmt_fk_liquidaciones_actualizado_por;
DEALLOCATE PREPARE stmt_fk_liquidaciones_actualizado_por;

SET @sql_fk_programaciones_creado_por = IF(
  EXISTS (SELECT 1 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND TABLE_NAME='programaciones' AND CONSTRAINT_NAME='fk_programaciones_creado_por'),
  'DO 0', 'ALTER TABLE programaciones ADD CONSTRAINT fk_programaciones_creado_por FOREIGN KEY (Creado_Por) REFERENCES usuarios(Id_Usuario) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE stmt_fk_programaciones_creado_por FROM @sql_fk_programaciones_creado_por;
EXECUTE stmt_fk_programaciones_creado_por;
DEALLOCATE PREPARE stmt_fk_programaciones_creado_por;

-- Old actor data can only be reconstructed from the current user and role rows.
-- Preserve any snapshot already populated by a previous partial execution.
UPDATE historial h
JOIN usuarios u ON u.Id_Usuario = h.Id_Usuario
LEFT JOIN roles r ON r.Id_Rol = u.Id_Rol
SET h.Actor_Nombre = COALESCE(h.Actor_Nombre,
      NULLIF(TRIM(u.Nombres_Apellidos), ''), NULLIF(TRIM(u.Usuario), '')),
    h.Actor_Rol = COALESCE(h.Actor_Rol, r.Nombre_Rol)
WHERE h.Id_Usuario IS NOT NULL
  AND (h.Actor_Nombre IS NULL OR h.Actor_Rol IS NULL);
