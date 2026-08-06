-- Fase 1: moneda y autoría confiables para reservas/transfers,
-- además de permisos canónicos para el módulo de Aforos.

ALTER TABLE reservas
  ADD COLUMN Id_Moneda BIGINT UNSIGNED NULL AFTER Id_Canal,
  ADD COLUMN Creado_Por BIGINT UNSIGNED NULL AFTER Observaciones,
  ADD COLUMN Actualizado_Por BIGINT UNSIGNED NULL AFTER Creado_Por,
  ADD KEY idx_reservas_moneda (Id_Moneda),
  ADD KEY idx_reservas_creado_por (Creado_Por),
  ADD KEY idx_reservas_actualizado_por (Actualizado_Por),
  ADD CONSTRAINT fk_reservas_moneda
    FOREIGN KEY (Id_Moneda) REFERENCES monedas (Id_Moneda)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_reservas_creado_por
    FOREIGN KEY (Creado_Por) REFERENCES usuarios (Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_reservas_actualizado_por
    FOREIGN KEY (Actualizado_Por) REFERENCES usuarios (Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE transfers
  ADD COLUMN Creado_Por BIGINT UNSIGNED NULL AFTER Observaciones,
  ADD COLUMN Actualizado_Por BIGINT UNSIGNED NULL AFTER Creado_Por,
  ADD KEY idx_transfers_creado_por (Creado_Por),
  ADD KEY idx_transfers_actualizado_por (Actualizado_Por),
  ADD CONSTRAINT fk_transfers_creado_por
    FOREIGN KEY (Creado_Por) REFERENCES usuarios (Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_transfers_actualizado_por
    FOREIGN KEY (Actualizado_Por) REFERENCES usuarios (Id_Usuario)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- El historial es la mejor evidencia disponible para operaciones antiguas.
-- No se inventa una moneda histórica: queda NULL hasta que la reserva sea revisada.
UPDATE reservas r
SET r.Creado_Por = (
  SELECT h.Id_Usuario
  FROM historial h
  INNER JOIN usuarios u ON u.Id_Usuario = h.Id_Usuario
  WHERE h.Tabla = 'reservas'
    AND h.Id_Registro = r.Id_Reserva
    AND h.Accion IN ('CREAR_RESERVA', 'DUPLICAR_RESERVA', 'CREAR')
  ORDER BY h.Fecha_Hora_Registro ASC, h.Id_Historial ASC
  LIMIT 1
)
WHERE r.Creado_Por IS NULL;

UPDATE reservas r
SET r.Actualizado_Por = (
  SELECT h.Id_Usuario
  FROM historial h
  INNER JOIN usuarios u ON u.Id_Usuario = h.Id_Usuario
  WHERE h.Tabla = 'reservas'
    AND h.Id_Registro = r.Id_Reserva
  ORDER BY h.Fecha_Hora_Registro DESC, h.Id_Historial DESC
  LIMIT 1
)
WHERE r.Actualizado_Por IS NULL;

UPDATE transfers tr
SET tr.Creado_Por = (
  SELECT h.Id_Usuario
  FROM historial h
  INNER JOIN usuarios u ON u.Id_Usuario = h.Id_Usuario
  WHERE h.Tabla = 'transfers'
    AND h.Id_Registro = CAST(tr.Id_Transfer AS CHAR)
    AND h.Accion IN ('CREAR_TRANSFER', 'CREAR')
  ORDER BY h.Fecha_Hora_Registro ASC, h.Id_Historial ASC
  LIMIT 1
)
WHERE tr.Creado_Por IS NULL;

UPDATE transfers tr
SET tr.Actualizado_Por = (
  SELECT h.Id_Usuario
  FROM historial h
  INNER JOIN usuarios u ON u.Id_Usuario = h.Id_Usuario
  WHERE h.Tabla = 'transfers'
    AND h.Id_Registro = CAST(tr.Id_Transfer AS CHAR)
  ORDER BY h.Fecha_Hora_Registro DESC, h.Id_Historial DESC
  LIMIT 1
)
WHERE tr.Actualizado_Por IS NULL;

INSERT INTO permisos (Accion, Codigo_Permiso, Descripcion, Modulo_Permiso)
VALUES
  ('LEER', 'AFOROS.LEER', 'Ver aforos y capacidad operativa', 'Aforos'),
  ('ACTUALIZAR', 'AFOROS.ACTUALIZAR', 'Actualizar aforos', 'Aforos')
ON DUPLICATE KEY UPDATE
  Accion = VALUES(Accion),
  Descripcion = VALUES(Descripcion),
  Modulo_Permiso = VALUES(Modulo_Permiso);

-- Conserva exactamente el alcance actual: quien tenía Inicio recibe su equivalente
-- canónico de Aforos. Los permisos anteriores quedan como alias de transición.
INSERT IGNORE INTO rol_permisos (Id_Rol, Id_Permiso)
SELECT rp.Id_Rol, nuevo.Id_Permiso
FROM rol_permisos rp
INNER JOIN permisos anterior ON anterior.Id_Permiso = rp.Id_Permiso
INNER JOIN permisos nuevo ON nuevo.Codigo_Permiso = 'AFOROS.LEER'
WHERE anterior.Codigo_Permiso = 'INICIO.LEER';

INSERT IGNORE INTO rol_permisos (Id_Rol, Id_Permiso)
SELECT rp.Id_Rol, nuevo.Id_Permiso
FROM rol_permisos rp
INNER JOIN permisos anterior ON anterior.Id_Permiso = rp.Id_Permiso
INNER JOIN permisos nuevo ON nuevo.Codigo_Permiso = 'AFOROS.ACTUALIZAR'
WHERE anterior.Codigo_Permiso = 'INICIO.ACTUALIZAR_AFORO';
