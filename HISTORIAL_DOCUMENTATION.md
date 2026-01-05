# 📋 Componente de Historial - Documentación

## 📁 Estructura de Archivos

```
frontend/src/app/pages/Historial/
├── ver-historial/
│   ├── ver-historial.ts       # Componente TypeScript
│   ├── ver-historial.html     # Template HTML
│   └── ver-historial.css      # Estilos

backend/
├── controllers/Historial/
│   └── historial.controller.js    # Controladores
├── services/Historial/
│   └── historial.service.js       # Servicios
└── routes/Historial/
    └── historial.routes.js        # Rutas
```

---

## 🎯 Características

### Frontend (VerHistorialComponent)

✅ **Tabla de Historial**
- Visualización de todas las acciones registradas
- Columnas: Fecha, Usuario, Acción, Tabla, ID Registro, Descripción, IP Address
- Colores codificados por tipo de acción (CREATE, UPDATE, DELETE, etc.)

✅ **Filtros Avanzados**
- Filtrar por Usuario
- Filtrar por Tipo de Acción (CREATE, READ, UPDATE, DELETE, LOGIN, LOGOUT, EXPORT, IMPORT)
- Filtrar por Tabla Afectada
- Filtrar por Rango de Fechas
- Búsqueda de texto libre

✅ **Paginación**
- Navegación por páginas
- Seleccionar número de registros por página
- Información del total de registros

✅ **Exportación**
- Exportar a CSV los registros filtrados
- Descarga directa en el navegador

✅ **Interfaz Responsive**
- Se adapta a dispositivos móviles
- Tabla scrolleable horizontalmente en móviles

---

## 🔧 Backend Implementation

### Servicio (historial.service.js)

```javascript
// Obtener historial con filtros y paginación
await historialService.getHistorial({
  usuario: 'Juan',
  tipoAccion: 'UPDATE',
  tablaAfectada: 'reservas',
  fechaInicio: '2025-01-01',
  fechaFin: '2025-01-31',
  search: 'texto',
  page: 1,
  limit: 10
});

// Registrar una acción en el historial
await historialService.registrarAccion({
  userId: 5,
  tipoAccion: 'UPDATE',
  descripcion: 'Se actualizó el precio del tour',
  tablaAfectada: 'tours',
  idRegistro: 10,
  ipAddress: '192.168.1.1',
  userAgent: 'Mozilla/5.0...'
});

// Exportar todos los registros filtrados
await historialService.exportarHistorial({
  usuario: 'Juan',
  tipoAccion: 'UPDATE'
});
```

### Controlador (historial.controller.js)

```javascript
// GET /api/historial?usuario=Juan&tipoAccion=UPDATE&page=1&limit=10
exports.getHistorial = async (req, res) => {
  // Obtiene historial con paginación
};

// GET /api/historial/export?usuario=Juan&tipoAccion=UPDATE
exports.exportHistorial = async (req, res) => {
  // Devuelve CSV del historial filtrado
};

// GET /api/historial/tabla?tabla=reservas&id=5
exports.obtenerHistorial = async (req, res) => {
  // Legacy: obtiene historial por tabla e ID
};
```

### Rutas (historial.routes.js)

```
GET  /api/historial          - Obtener historial con filtros
GET  /api/historial/export   - Exportar a CSV
GET  /api/historial/tabla    - Legacy: historial por tabla
```

---

## 📊 Estructura de Datos

### Tabla: historial

```sql
CREATE TABLE historial (
  Id_Historial INT PRIMARY KEY AUTO_INCREMENT,
  Id_Usuario INT,
  Tipo_Accion VARCHAR(50),      -- CREATE, UPDATE, DELETE, LOGIN, etc.
  Descripcion TEXT,
  Tabla_Afectada VARCHAR(100),
  Id_Registro INT,
  Fecha_Accion DATETIME,
  IP_Address VARCHAR(50),
  User_Agent TEXT,
  FOREIGN KEY (Id_Usuario) REFERENCES usuarios(Id_Usuario)
);
```

### Tipos de Acciones

| Tipo | Color | Descripción |
|------|-------|------------|
| CREATE | Verde (#28a745) | Crear nuevo registro |
| READ | Azul Cyan (#17a2b8) | Leer/ver registro |
| UPDATE | Amarillo (#ffc107) | Actualizar registro |
| DELETE | Rojo (#dc3545) | Eliminar registro |
| LOGIN | Azul (#007bff) | Inicio de sesión |
| LOGOUT | Gris (#6c757d) | Cierre de sesión |
| EXPORT | Verde Agua (#20c997) | Exportar datos |
| IMPORT | Púrpura (#6610f2) | Importar datos |

---

## 🚀 Cómo Usar

### En el Frontend

#### Acceder al Historial

```typescript
// En el layout, agregar link al historial
<a routerLink="/Historial">📋 Historial</a>
```

#### Permisos Necesarios

```typescript
// Proteger con permiso (en layout.html)
<a *appPermiso="'HISTORIAL.LEER'" routerLink="/Historial">Historial</a>
```

### En el Backend

#### Registrar una Acción

```javascript
// Cuando se crea una reserva
const historialService = require('../../services/Historial/historial.service');

await historialService.registrarAccion({
  userId: req.user.id,
  tipoAccion: 'CREATE',
  descripcion: 'Nueva reserva creada: ' + reserva.Id_Reserva,
  tablaAfectada: 'reservas',
  idRegistro: reserva.Id_Reserva,
  ipAddress: req.ip,
  userAgent: req.headers['user-agent']
});
```

#### Ejemplo en Routes

```javascript
const historialService = require('../../services/Historial/historial.service');

router.post('/crear', authMiddleware, async (req, res) => {
  try {
    const nuevaReserva = await reservasService.crear(req.body);
    
    // Registrar en historial
    await historialService.registrarAccion({
      userId: req.user.id,
      tipoAccion: 'CREATE',
      descripcion: `Reserva creada: ${nuevaReserva.Referencia}`,
      tablaAfectada: 'reservas',
      idRegistro: nuevaReserva.Id_Reserva,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.json(nuevaReserva);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

---

## 🎨 Interfaz Visual

### Tabla Principal
- **Headers**: Fecha, Usuario, Acción, Tabla, ID Registro, Descripción, IP
- **Filas**: Datos de cada acción con hover effect
- **Colores**: Códigos de color por tipo de acción

### Filtros
- **Barra Superior**: Búsqueda rápida
- **Botón "Filtros"**: Abre/cierra panel avanzado
- **Panel Avanzado**: Formulario con todos los filtros disponibles
- **Tokens Activos**: Muestra filtros aplicados con botones X para limpiarlos

### Paginación
- **Botones**: Anterior / Siguiente
- **Información**: "Página X de Y (Total registros)"
- **Deshabilitado**: Cuando no hay más páginas

### Acciones
- **Buscar**: Ejecuta búsqueda con filtros
- **Limpiar**: Resetea todos los filtros
- **Exportar**: Descarga CSV

---

## 📱 Responsive Design

### Desktop (≥ 768px)
- Tabla completa con todas las columnas visibles
- Filtros en una fila
- Layout de dos columnas

### Mobile (< 768px)
- Tabla con scroll horizontal
- Filtros apilados verticalmente
- Botones a ancho completo
- Fuentes más pequeñas
- Espaciado reducido

---

## 🔐 Seguridad

✅ **Autenticación**
- Todos los endpoints requieren JWT válido
- Token verificado en authMiddleware

✅ **Autorización**
- Se registra el IP y User-Agent de quien realiza la acción
- Se registra el usuario autenticado (req.user.id)

✅ **Validación**
- Parámetros validados en controlador
- Queries preparadas para evitar SQL Injection

---

## 📈 Rendimiento

- **Índices**: Se recomienda agregar índices en:
  ```sql
  CREATE INDEX idx_historial_usuario ON historial(Id_Usuario);
  CREATE INDEX idx_historial_tabla ON historial(Tabla_Afectada);
  CREATE INDEX idx_historial_fecha ON historial(Fecha_Accion);
  ```

- **Paginación**: Reducir carga usando LIMIT y OFFSET

- **Limpieza**: Considerar archivar historial antiguo (> 6 meses)

---

## 🧪 Pruebas

### Test 1: Ver Historial
```bash
1. Ir a /Historial
2. ✅ Debe cargar tabla con datos
3. ✅ Debe mostrar mensaje "No hay registros" si está vacío
```

### Test 2: Filtros
```bash
1. Escribir en búsqueda "Juan"
2. Clic en "Buscar"
3. ✅ Debe filtrar solo registros de usuario "Juan"
4. ✅ Debe actualizar paginación
```

### Test 3: Exportar
```bash
1. Aplicar filtros
2. Clic en "Exportar"
3. ✅ Debe descargar archivo CSV
4. ✅ Nombre: historial-YYYY-MM-DD.csv
```

### Test 4: Paginación
```bash
1. Con múltiples registros
2. Clic en "Siguiente"
3. ✅ Debe cargar página siguiente
4. ✅ Botón "Anterior" debe activarse
```

---

## 🔄 Próximas Mejoras

- [ ] Gráficos de actividad por usuario/tabla
- [ ] Alertas en tiempo real para acciones críticas
- [ ] Comparativa antes/después para cambios
- [ ] Auditoría de eliminaciones (soft delete)
- [ ] Integración con dashboard de análisis
- [ ] Exportación a Excel con formato
- [ ] Búsqueda avanzada con operadores

---

## 📞 Soporte

Para dudas o problemas con el historial, revisa:
1. La consola del navegador (DevTools)
2. Los logs del backend
3. La conexión a la BD
4. Los permisos del usuario
