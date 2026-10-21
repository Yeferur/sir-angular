-- Ejecutar manualmente solo después de revisar el resultado del SELECT de conteo.
-- El borrado se limita al prefijo MKT2D_; respeta primero pasajeros y operaciones,
-- y elimina entidades al final por sus llaves foráneas.
SET @demo_prefix = 'MKT2D_';
START TRANSACTION;

SELECT
  (SELECT COUNT(*) FROM pasajeros p JOIN reservas r ON r.Id_Reserva=p.Id_Reserva
    WHERE LEFT(r.Id_Reserva, CHAR_LENGTH(@demo_prefix))=@demo_prefix) AS pasajeros_a_borrar,
  (SELECT COUNT(*) FROM reservas WHERE LEFT(Id_Reserva, CHAR_LENGTH(@demo_prefix))=@demo_prefix) AS reservas_a_borrar,
  (SELECT COUNT(*) FROM transfers WHERE LEFT(Nombre_Titular, CHAR_LENGTH(@demo_prefix))=@demo_prefix
    OR LEFT(Observaciones, CHAR_LENGTH(@demo_prefix))=@demo_prefix) AS transfers_a_borrar,
  (SELECT COUNT(*) FROM pendientes_operativos p JOIN entidades_reportantes e
    ON p.Entidad_Tipo='ENTIDAD_REPORTANTE' AND p.Entidad_Id=CAST(e.Id_Entidad_Reportante AS CHAR)
    WHERE LEFT(e.Nombre, CHAR_LENGTH(@demo_prefix))=@demo_prefix) AS pendientes_a_borrar,
  (SELECT COUNT(*) FROM pendientes_eventos pe JOIN pendientes_operativos p ON p.Id_Pendiente=pe.Id_Pendiente
    JOIN entidades_reportantes e ON p.Entidad_Tipo='ENTIDAD_REPORTANTE'
      AND p.Entidad_Id=CAST(e.Id_Entidad_Reportante AS CHAR)
    WHERE LEFT(e.Nombre, CHAR_LENGTH(@demo_prefix))=@demo_prefix) AS eventos_pendiente_a_borrar,
  (SELECT COUNT(*) FROM notificaciones n JOIN entidades_reportantes e
    ON n.Entidad_Tipo='ENTIDAD_REPORTANTE' AND n.Entidad_Id=CAST(e.Id_Entidad_Reportante AS CHAR)
    WHERE LEFT(e.Nombre, CHAR_LENGTH(@demo_prefix))=@demo_prefix
      AND n.Tipo IN ('PENDIENTE','ENTIDAD_REPORTANTE_RECHAZADA')) AS notificaciones_a_borrar,
  (SELECT COUNT(*) FROM entidades_reportantes WHERE LEFT(Nombre, CHAR_LENGTH(@demo_prefix))=@demo_prefix) AS entidades_a_borrar;

-- Primero se borran los avisos generados por pendientes y rechazos de las entidades demo.
DELETE n FROM notificaciones n
JOIN entidades_reportantes e
  ON n.Entidad_Tipo='ENTIDAD_REPORTANTE' AND n.Entidad_Id=CAST(e.Id_Entidad_Reportante AS CHAR)
WHERE LEFT(e.Nombre, CHAR_LENGTH(@demo_prefix))=@demo_prefix
  AND n.Tipo IN ('PENDIENTE','ENTIDAD_REPORTANTE_RECHAZADA');

-- Se borran explícitamente los eventos antes de sus pendientes para respetar las FK.
DELETE pe FROM pendientes_eventos pe
JOIN pendientes_operativos p ON p.Id_Pendiente=pe.Id_Pendiente
JOIN entidades_reportantes e ON p.Entidad_Tipo='ENTIDAD_REPORTANTE'
  AND p.Entidad_Id=CAST(e.Id_Entidad_Reportante AS CHAR)
WHERE LEFT(e.Nombre, CHAR_LENGTH(@demo_prefix))=@demo_prefix;

DELETE p FROM pendientes_operativos p
JOIN entidades_reportantes e ON p.Entidad_Tipo='ENTIDAD_REPORTANTE'
  AND p.Entidad_Id=CAST(e.Id_Entidad_Reportante AS CHAR)
WHERE LEFT(e.Nombre, CHAR_LENGTH(@demo_prefix))=@demo_prefix;

DELETE p FROM pasajeros p JOIN reservas r ON r.Id_Reserva=p.Id_Reserva
WHERE LEFT(r.Id_Reserva, CHAR_LENGTH(@demo_prefix))=@demo_prefix;

DELETE FROM reservas
WHERE LEFT(Id_Reserva, CHAR_LENGTH(@demo_prefix))=@demo_prefix;

DELETE FROM transfers
WHERE LEFT(Nombre_Titular, CHAR_LENGTH(@demo_prefix))=@demo_prefix
   OR LEFT(Observaciones, CHAR_LENGTH(@demo_prefix))=@demo_prefix;

DELETE FROM entidades_reportantes
WHERE LEFT(Nombre, CHAR_LENGTH(@demo_prefix))=@demo_prefix;

COMMIT;
