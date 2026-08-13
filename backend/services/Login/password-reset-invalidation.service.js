async function invalidatePendingPasswordResets(executor, userId, email = null, reason = 'Credenciales actualizadas.') {
  await executor.query(
    'DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL',
    [userId]
  );

  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return;
  await executor.query(
    `UPDATE email_outbox
     SET Estado = 'fallido', Fallido_En = NOW(), Ultimo_Error = ?,
         Payload = JSON_OBJECT(), Fecha_Actualizacion = NOW()
     WHERE Tipo = 'password_reset' AND Destinatario = ?
       AND Estado IN ('pendiente', 'procesando')`,
    [reason, normalizedEmail]
  );
}

module.exports = { invalidatePendingPasswordResets };
