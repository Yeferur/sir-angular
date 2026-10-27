-- Integridad de planes, disponibilidad y confirmaciones sin perder referencias.
-- Preconditions verificados en sir2: cero huérfanos en las cuatro columnas.
ALTER TABLE pasajeros
  ADD CONSTRAINT fk_pasajeros_plan
  FOREIGN KEY (Id_Plan) REFERENCES planes_tours(Id_Plan)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE disponibilidad
  ADD CONSTRAINT fk_disponibilidad_tour
  FOREIGN KEY (Id_Tour) REFERENCES tours(Id_Tour)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE confirmaciones_jornada
  ADD CONSTRAINT fk_confirmaciones_jornada_tour
  FOREIGN KEY (Id_Tour) REFERENCES tours(Id_Tour)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE confirmaciones_jornada
  ADD CONSTRAINT fk_confirmaciones_jornada_confirmada_por
  FOREIGN KEY (Confirmada_Por) REFERENCES usuarios(Id_Usuario)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE tour_comisiones
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
