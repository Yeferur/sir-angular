-- Preconditions: zero orphans in the three financial relationships.
-- Distinct replacement names avoid MySQL's duplicate-FK-name rejection.
ALTER TABLE pagos_reservas
  DROP FOREIGN KEY fk_pagosreserva_reserva,
  ADD CONSTRAINT fk_pagosreserva_reserva_restrict
  FOREIGN KEY (Id_Reserva) REFERENCES reservas(Id_Reserva)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE pagos_transfers
  DROP FOREIGN KEY fk_pagostransfers_transfer,
  ADD CONSTRAINT fk_pagostransfers_transfer_restrict
  FOREIGN KEY (Id_Transfer) REFERENCES transfers(Id_Transfer)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE liquidaciones
  DROP FOREIGN KEY fk_liquidacion_reserva,
  ADD CONSTRAINT fk_liquidacion_reserva_restrict
  FOREIGN KEY (Id_Reserva) REFERENCES reservas(Id_Reserva)
  ON DELETE RESTRICT ON UPDATE CASCADE;
