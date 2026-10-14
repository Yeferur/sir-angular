-- Preconditions: tour_comisiones is InnoDB; both references have zero orphans.
ALTER TABLE tour_comisiones
  ADD CONSTRAINT fk_tour_comisiones_tour
  FOREIGN KEY (Id_Tour) REFERENCES tours(Id_Tour)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE tour_comisiones
  ADD CONSTRAINT fk_tour_comisiones_canal
  FOREIGN KEY (Id_Canal) REFERENCES canales_reservas(Id_Canal)
  ON DELETE RESTRICT ON UPDATE CASCADE;
