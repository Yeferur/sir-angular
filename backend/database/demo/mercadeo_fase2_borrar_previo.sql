-- Solo lectura: muestra el número exacto de filas etiquetadas antes de ejecutar el borrado.
SET @demo_prefix = 'MKT2D_';
SELECT
  (SELECT COUNT(*) FROM pasajeros p JOIN reservas r ON r.Id_Reserva=p.Id_Reserva
    WHERE LEFT(r.Id_Reserva, CHAR_LENGTH(@demo_prefix))=@demo_prefix) AS pasajeros,
  (SELECT COUNT(*) FROM reservas WHERE LEFT(Id_Reserva, CHAR_LENGTH(@demo_prefix))=@demo_prefix) AS reservas,
  (SELECT COUNT(*) FROM transfers WHERE LEFT(Nombre_Titular, CHAR_LENGTH(@demo_prefix))=@demo_prefix
    OR LEFT(Observaciones, CHAR_LENGTH(@demo_prefix))=@demo_prefix) AS transfers,
  (SELECT COUNT(*) FROM entidades_reportantes WHERE LEFT(Nombre, CHAR_LENGTH(@demo_prefix))=@demo_prefix) AS entidades;
