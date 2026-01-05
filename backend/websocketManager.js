// Emitir evento de aforo actualizado a todos los clientes menos el que lo actualizó
function broadcastAforoActualizado({ Id_Tour, Nombre_Tour, NuevoCupo, userId }) {
  try {
    const payload = JSON.stringify({
      type: 'aforoActualizado',
      Id_Tour,
      Nombre_Tour,
      NuevoCupo
    });
    
    let enviados = 0;
    for (const [uid, socket] of clients.entries()) {
      if (uid !== userId && socket.readyState === 1) {
        socket.send(payload);
        enviados++;
      }
    }
    console.log(`📡 Broadcast Aforo: Enviado a ${enviados} clientes (Tour ${Id_Tour}, Cupo: ${NuevoCupo})`);
  } catch (err) {
    console.error('Error en broadcastAforoActualizado:', err.message);
  }
}

// Emitir evento de reserva creada/actualizada a todos los clientes
function broadcastReservaEvento(evento) {
  try {
    const payload = JSON.stringify(evento);
    
    let enviados = 0;
    for (const socket of clients.values()) {
      if (socket.readyState === 1) {
        socket.send(payload);
        enviados++;
      }
    }
    console.log(`📡 Broadcast Reserva: Enviado a ${enviados} clientes (Tipo: ${evento.type})`);
  } catch (err) {
    console.error('Error en broadcastReservaEvento:', err.message);
  }
}
const db = require('./database/db');


const clients = new Map(); // userId -> socket
const disconnectingUsers = new Set(); // usuarios que se están desconectando

async function addClient(userId, socket) {
  disconnectingUsers.delete(userId); // Limpiar si estaba marcado
  clients.set(userId, socket);
  console.log(`✅ Cliente agregado: ${userId}, total: ${clients.size}`);
  await broadcastActiveUsers().catch(err => console.error('Error en addClient broadcast:', err));
}

async function removeClient(userId) {
  // Evitar dobles remociones
  if (disconnectingUsers.has(userId)) {
    console.log(`⚠️ Usuario ${userId} ya en proceso de desconexión`);
    return;
  }
  
  disconnectingUsers.add(userId);
  clients.delete(userId);
  console.log(`❌ Cliente removido: ${userId}, total: ${clients.size}`);
  
  // Pequeño delay para asegurar que se procese la BD antes de broadcast
  await new Promise(resolve => setTimeout(resolve, 50));
  
  await broadcastActiveUsers().catch(err => console.error('Error en removeClient broadcast:', err));
}

function getClient(userId) {
  return clients.get(userId);
}

function getAllActiveUsers() {
  return Array.from(clients.keys());
}


async function broadcastActiveUsers() {
  try {
    const usuarios = getAllActiveUsers();

    // Consulta las sesiones activas en DB
    const [rows] = await db.query('SELECT Id_Usuario FROM sesiones');
    const sesionesDB = rows.map(r => r.Id_Usuario);

    const payload = JSON.stringify({
      type: "usuarios_conectados_actualizados",
      usuarios,
      sesiones: sesionesDB
    });

    console.log(`📡 Broadcast: ${usuarios.length} conectados, ${sesionesDB.length} en DB`);

    for (const socket of clients.values()) {
      if (socket.readyState === 1) {
        socket.send(payload);
      }
    }
  } catch (err) {
    console.error('Error en broadcastActiveUsers:', err.message);
  }
}


module.exports = {
  addClient,
  removeClient,
  getClient,
  getAllActiveUsers,
  broadcastActiveUsers
  ,broadcastReservaEvento
  ,broadcastAforoActualizado
};