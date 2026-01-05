# ✅ Fix: Diferenciación entre Logout Normal y Forzado

## 🔴 Problema Original
Cuando un usuario hacía logout desde su propia sesión, recibía el mensaje:
> "Tu sesión fue cerrada por un administrador"

Esto era incorrecto porque el usuario estaba cerrando su propia sesión, no siendo forzado por un admin.

---

## ✅ Solución Implementada

### Backend Changes

#### 1. **login.controller.js** - Dos funciones separadas

**Logout Normal** (`/logout` - el usuario cierra su propia sesión):
```javascript
exports.logout = async (req, res) => {
  const userId = req.user?.id;  // Del token autenticado
  await loginService.logoutUserById(userId, false); // false = normal
  return res.json({ success: true });
};
```

**Forzar Logout** (`/forceLogout` - solo admin cierra sesión de otro):
```javascript
exports.forceLogout = async (req, res) => {
  const { userId } = req.body;  // Usuario a desconectar
  const adminId = req.user?.id;  // Admin que ejecuta
  
  // Validar que sea admin (Role_ID = 1)
  // Validar que no sea a sí mismo
  // Luego cerrar sesión del usuario
  await loginService.logoutUserById(userId, true); // true = forced
};
```

#### 2. **login.service.js** - Lógica diferenciada

```javascript
async function logoutUserById(userId, isForced = false) {
  // ... eliminar sesiones ...
  
  // Enviar tipo diferente según si es normal o forzado
  const messageType = isForced ? 'force-logout' : 'logout';
  clientSocket.send(JSON.stringify({ type: messageType }));
}
```

#### 3. **login.routes.js** - Nueva ruta para admin

```javascript
router.post('/logout', authMiddleware, loginController.logout);
router.post('/forceLogout', authMiddleware, loginController.forceLogout);
```

---

### Frontend Changes

#### 1. **app.ts** - Diferenciar mensajes WebSocket

```typescript
// Logout forzado: mostrar alerta (admin cerró sesión)
if (msg.type === 'force-logout') {
  this.navbar.alert.set({
    message: 'Tu sesión fue cerrada por un administrador.',
  });
}

// Logout normal: sin alerta (usuario cerró sesión)
if (msg.type === 'logout') {
  console.log('✅ Sesión cerrada correctamente.');
  this.auth.logout();
}
```

#### 2. **usuarios.ts** - Cambiar endpoint para admin

```typescript
// Antes: return this.http.post(`${environment.apiUrl}/logout`, { userId });
// Después:
forzarCierreSesion(userId: string): Observable<any> {
  return this.http.post(`${environment.apiUrl}/forceLogout`, { userId });
}
```

---

## 🔄 Flujo de Funcionamiento

### Scenario 1: Usuario cierra su propia sesión
```
1. Usuario click en "Salir" (handleLogout)
2. Frontend: POST /logout (con su token en header)
3. Backend: Identifica userId del token → logoutUserById(userId, false)
4. WebSocket: Envía { type: 'logout' }
5. Frontend: Solo ejecuta logout sin mostrar alerta
✅ Resultado: "Sesión cerrada correctamente"
```

### Scenario 2: Admin cierra sesión de otro usuario
```
1. Admin selecciona usuario en panel de administración
2. Frontend: POST /forceLogout { userId }
3. Backend: Valida que sea admin → logoutUserById(userId, true)
4. WebSocket: Envía { type: 'force-logout' }
5. Frontend: Muestra alerta al usuario
✅ Resultado: "Tu sesión fue cerrada por un administrador"
```

---

## 🔐 Validaciones de Seguridad

El endpoint `/forceLogout` incluye:

✅ **Validación de Admin**: Solo usuarios con `Role_ID = 1`
✅ **Prevención de Auto-Logout**: No pueden cerrarse a sí mismos
✅ **Autenticación JWT**: Requiere token válido en header
✅ **Validación de Sesión**: Token debe estar activo en BD

```javascript
if (!adminUser || adminUser.Role_ID !== 1) {
  return res.status(403).json({ error: 'No tienes permisos' });
}

if (adminId === userId) {
  return res.status(400).json({ error: 'No puedes forzar tu propio logout' });
}
```

---

## 📋 Cambios Resumidos

| Archivo | Cambio | Motivo |
|---------|--------|--------|
| `login.controller.js` | Dividir logout en 2 funciones | Distinguir logout normal vs forzado |
| `login.service.js` | Agregar parámetro `isForced` | Enviar tipo correcto de mensaje |
| `login.routes.js` | Agregar ruta `/forceLogout` | Endpoint separado para admin |
| `app.ts` | Diferenciar `logout` vs `force-logout` | Mostrar alerta solo si es forzado |
| `usuarios.ts` | Cambiar a `/forceLogout` | Usar endpoint correcto |

---

## 🧪 Cómo Probar

### Test 1: Logout normal
```bash
1. Login como usuario normal
2. Click en "Salir"
3. ✅ Esperar: No debe haber alerta roja
4. ✅ Debe ir a login normal
```

### Test 2: Logout forzado (Admin)
```bash
1. Login como Admin en una terminal
2. Login como Usuario en otra terminal
3. Admin: Ir a Usuarios → Seleccionar usuario → "Cerrar Sesión"
4. Usuario: ✅ Debe ver alerta roja "Tu sesión fue cerrada por un administrador"
5. Usuario: Debe ser redirigido a login después de 3 segundos
```

---

## ❌ Error Handling

Si algo falla:

```javascript
// Admin intenta forzar logout sin ser admin
POST /forceLogout { userId: 5 }
❌ 403: "No tienes permisos para forzar logout"

// Admin intenta cerrarse a sí mismo
POST /forceLogout { userId: 1 }  // Admin es ID 1
❌ 400: "No puedes forzar tu propio logout"

// Usuario normal intenta /forceLogout
POST /forceLogout (con Role_ID = 2)
❌ 403: "No tienes permisos para forzar logout"
```

---

## 📝 Notas Importantes

- El `/logout` normal NO necesita `userId` en body, lo obtiene del token
- El `/forceLogout` requiere `userId` en body (el usuario a desconectar)
- Ambos requieren token válido en header (`Authorization: Bearer <token>`)
- El WebSocket notificará al usuario con el tipo correcto de mensaje
