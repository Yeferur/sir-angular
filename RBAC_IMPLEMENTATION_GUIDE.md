# Sistema RBAC (Role-Based Access Control) - Guía de Implementación

## 📋 Descripción General

Se ha implementado un sistema completo de **control de acceso basado en roles (RBAC)** que permite:

- ✅ Gestionar roles y permisos de usuarios
- ✅ Asignar permisos granulares a cada rol (CREATE, READ, UPDATE, DELETE, DOWNLOAD)
- ✅ Menú dinámico que se adapta a los permisos del usuario
- ✅ Protección de rutas y endpoints con middleware de permisos
- ✅ Auditoría de cambios en la base de datos (integrado con sistema anterior de historial)

---

## 🗄️ Base de Datos - Estructura RBAC

### Tablas Creadas

#### 1. **roles**
```sql
CREATE TABLE roles (
  Id_Rol bigint UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  Nombre_Rol varchar(100) UNIQUE NOT NULL,
  Descripcion varchar(255),
  Activo tinyint(1) DEFAULT 1,
  Fecha_Creacion datetime DEFAULT CURRENT_TIMESTAMP
);
```

Roles predefinidos:
- **Administrador**: Acceso total al sistema
- **Asesor**: Gestión de reservas y consultas
- **Consultor_TG_CTG_SF_CT**: Consultor especializado (solo lectura)
- **Operador**: Gestión de programación y operaciones
- **Solo_Lectura**: Acceso de solo lectura

---

#### 2. **modulos**
```sql
CREATE TABLE modulos (
  Id_Modulo bigint UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  Nombre_Modulo varchar(100) NOT NULL,
  Codigo_Modulo varchar(50) UNIQUE NOT NULL,
  Descripcion varchar(255),
  Icono varchar(50),
  Ruta varchar(255),
  Orden int DEFAULT 0,
  Activo tinyint(1) DEFAULT 1
);
```

Módulos disponibles:
- INICIO (Dashboard)
- RESERVAS
- TOURS
- PUNTOS (Puntos de encuentro)
- PROGRAMACION (Programación de rutas)
- TRANSFERS
- USUARIOS (Gestión de usuarios)
- HISTORIAL
- REPORTES

---

#### 3. **permisos**
```sql
CREATE TABLE permisos (
  Id_Permiso bigint UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  Id_Modulo bigint UNSIGNED NOT NULL,
  Accion varchar(50) NOT NULL,
  Codigo_Permiso varchar(100) UNIQUE NOT NULL,
  Descripcion varchar(255),
  FOREIGN KEY (Id_Modulo) REFERENCES modulos(Id_Modulo)
);
```

Formato de permisos: **MODULO.ACCION**
Ejemplo: `TOURS.CREAR`, `RESERVAS.ACTUALIZAR`, `PUNTOS.ELIMINAR`

---

#### 4. **rol_permisos** (Relación Muchos-a-Muchos)
```sql
CREATE TABLE rol_permisos (
  Id_Rol_Permiso bigint UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  Id_Rol bigint UNSIGNED NOT NULL,
  Id_Permiso bigint UNSIGNED NOT NULL,
  Fecha_Asignacion datetime DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY ux_rol_permiso (Id_Rol, Id_Permiso),
  FOREIGN KEY (Id_Rol) REFERENCES roles(Id_Rol),
  FOREIGN KEY (Id_Permiso) REFERENCES permisos(Id_Permiso)
);
```

---

#### 5. **usuarios (Modificada)**
Se agregó la columna `Id_Rol` a la tabla existente:
```sql
ALTER TABLE usuarios 
  ADD COLUMN Id_Rol bigint UNSIGNED DEFAULT NULL,
  ADD KEY idx_usuarios_rol (Id_Rol),
  ADD CONSTRAINT fk_usuarios_rol FOREIGN KEY (Id_Rol) REFERENCES roles(Id_Rol);
```

---

## 🚀 Pasos de Implementación

### 1. **Ejecutar la Migración SQL**

```bash
# Conectar a la BD y ejecutar:
mysql -u root -p nombre_bd < backend/database/migrations/001_rbac_permissions.sql
```

O ejecutar el contenido del archivo en phpMyAdmin/MySQL Workbench.

**La migración realiza:**
- Crea tablas RBAC
- Inserta roles predefinidos
- Inserta módulos de la aplicación
- Inserta permisos estándar (CRUD + Acciones especiales)
- Asigna permisos a roles por defecto
- Migra usuarios existentes a nuevos roles

---

### 2. **Backend - Instalar Dependencias**

Si no están instaladas:
```bash
npm install
```

---

### 3. **Backend - Estructura de Archivos**

Nueva estructura creada:

```
backend/
├── database/
│   └── migrations/
│       └── 001_rbac_permissions.sql          ← Migración
│
├── middlewares/
│   └── permissionsMiddleware.js              ← Middleware de permisos
│
├── services/
│   └── Permisos/
│       └── permisos.service.js               ← Lógica de permisos
│
├── controllers/
│   └── Permisos/
│       └── permisos.controller.js            ← Controlador de permisos
│
└── routes/
    └── Permisos/
        └── permisos.routes.js                ← Rutas de permisos
```

---

### 4. **Backend - Middleware de Permisos**

#### Cómo funciona `permissionsMiddleware.js`:

```typescript
// Verificar un permiso específico
router.post('/tours', 
  authMiddleware, 
  checkPermission('TOURS.CREAR'),  ← Middleware de permisos
  toursController.crearTour
);

// Verificar múltiples permisos (al menos uno)
router.put('/reservas/:id',
  authMiddleware,
  checkAnyPermission(['RESERVAS.ACTUALIZAR', 'USUARIOS.GESTIONAR_ROLES']),
  reservasController.updateReserva
);

// Solo administradores
router.get('/admin/panel',
  authMiddleware,
  requireAdmin(),
  adminController.getPanel
);
```

#### Características:

- **Cache en memoria**: Los permisos se cachean por 5 minutos para reducir queries
- **Invalidación de cache**: Se puede invalidar manualmente cuando cambian roles/permisos
- **Respuestas consistentes**: Devuelve 401 si no autenticado, 403 si sin permisos

---

### 5. **Rutas Protegidas Actualizadas**

Todas las siguientes rutas ya tienen protección de permisos:

#### Tours
- `GET /api/tours` → `TOURS.LEER`
- `POST /api/tours` → `TOURS.CREAR`
- `PUT /api/tours/:id` → `TOURS.ACTUALIZAR`
- `DELETE /api/tours/:id` → `TOURS.ELIMINAR`

#### Reservas
- `GET /api/reservas` → `RESERVAS.LEER`
- `POST /api/reservas` → `RESERVAS.CREAR`
- `PUT /api/reservas/:id` → `RESERVAS.ACTUALIZAR`
- `DELETE /api/reservas/:id` → `RESERVAS.ELIMINAR` (via historial)

#### Puntos
- `GET /api/puntos` → `PUNTOS.LEER`
- `POST /api/puntos` → `PUNTOS.CREAR`
- `PUT /api/puntos/:id` → `PUNTOS.ACTUALIZAR`
- `DELETE /api/puntos/:id` → `PUNTOS.ELIMINAR`

#### Programación
- `POST /api/programacion/plan-logistico` → `PROGRAMACION.CREAR`
- `POST /api/programacion/plan-asistido` → `PROGRAMACION.CREAR`

#### Inicio (Dashboard)
- `GET /api/tours-data` → `INICIO.LEER`
- `POST /api/guardar-aforo` → `INICIO.ACTUALIZAR_AFORO`

#### Transfers
- `GET /api/Transfer/*` → `TRANSFERS.LEER`
- `POST /api/Transfer/*` → `TRANSFERS.CREAR`

#### Usuarios
- `GET /api/usuarios-sesiones` → `USUARIOS.LEER`

---

### 6. **API Endpoints de Permisos**

#### Públicos (Usuario Autenticado)

```http
GET /api/me/permisos
```
Retorna: Lista de permisos del usuario actual
```json
{
  "permisos": [
    {
      "codigo": "TOURS.CREAR",
      "accion": "CREAR",
      "modulo": "TOURS",
      "nombreModulo": "Tours",
      "descripcion": "Crear nuevos tours"
    }
  ]
}
```

```http
GET /api/me/menu
```
Retorna: Menú dinámico basado en permisos
```json
{
  "menu": [
    {
      "id": 1,
      "nombre": "Inicio",
      "codigo": "INICIO",
      "icono": "home",
      "ruta": "/Inicio",
      "orden": 1
    }
  ]
}
```

#### Administración (Solo Admin - `USUARIOS.GESTIONAR_ROLES`)

```http
GET /api/roles
POST /api/roles
PUT /api/roles/:idRol
DELETE /api/roles/:idRol

GET /api/modulos
GET /api/permisos
GET /api/roles/:idRol/permisos

POST /api/rol-permisos          # Asignar permiso a rol
DELETE /api/rol-permisos        # Revocar permiso de rol

POST /api/cache/invalidar       # Invalida cache de permisos
```

---

## 🎨 Frontend - Componentes Creados

### 1. **PermisosService** (`frontend/src/app/services/Permisos/permisos.service.ts`)

```typescript
// Obtener permisos y menú del usuario
permisosService.obtenerMisPermisos().subscribe(...);
permisosService.obtenerMiMenu().subscribe(...);

// Verificar permisos
permisosService.tienePermiso('TOURS.CREAR');                    // boolean
permisosService.tieneAlgunPermiso(['TOURS.CREAR', 'TOURS.ACTUALIZAR']); // boolean
permisosService.tieneTodosPermisos(['TOURS.CREAR', 'TOURS.ACTUALIZAR']); // boolean

// Observables para suscribirse a cambios
permisosService.permisos$.subscribe(permisos => {...});
permisosService.menu$.subscribe(menu => {...});

// Gestión de cache
permisosService.cargarPermisosDesdeLocalStorage();  // Al iniciar app
permisosService.limpiarPermisos();                  // Al logout
```

---

### 2. **Directiva @appPermiso** (`frontend/src/app/shared/directives/permiso.directive.ts`)

Muestra/oculta elementos del template según permisos:

```html
<!-- Mostrar solo si tiene permiso -->
<button *appPermiso="'TOURS.CREAR'">Crear Tour</button>

<!-- Mostrar si tiene al menos uno de varios permisos -->
<div *appPermiso="['RESERVAS.CREAR', 'RESERVAS.ACTUALIZAR']">
  Gestionar reservas
</div>

<!-- Mostrar solo si tiene TODOS los permisos -->
<div *appPermiso="['TOURS.LEER', 'TOURS.ACTUALIZAR']; requireAll: true">
  Solo si tiene ambos permisos
</div>
```

---

### 3. **DynamicNavbarComponent** (`frontend/src/app/shared/components/dynamic-navbar/dynamic-navbar.component.ts`)

Barra de navegación que se adapta automáticamente a los permisos:

```html
<app-dynamic-navbar></app-dynamic-navbar>
```

- Muestra solo módulos para los que el usuario tiene permisos
- Menú desplegable de usuario
- Botón "Administración" visible solo para admins
- Opción de cerrar sesión

---

### 4. **PermissionsAdminComponent** (`frontend/src/app/pages/Administracion/permissions-admin/permissions-admin.component.ts`)

Interfaz completa para administrar roles y permisos:

**Tab 1: Gestionar Roles**
- Listar todos los roles
- Crear nuevo rol
- Editar rol existente
- Eliminar rol
- Cambiar estado (activo/inactivo)

**Tab 2: Asignar Permisos**
- Seleccionar rol
- Ver permisos disponibles
- Ver permisos asignados
- Asignar/revocar permisos
- Búsqueda de permisos

---

## 🔄 Integración en App Principal

En `frontend/src/app/app.ts`:

```typescript
ngOnInit() {
  // Al login exitoso, cargar permisos y menú
  this.auth.isLoggedIn().subscribe((logged) => {
    if (logged) {
      this.permisosService.obtenerMisPermisos().subscribe(...);
      this.permisosService.obtenerMiMenu().subscribe(...);
    } else {
      this.permisosService.limpiarPermisos();
    }
  });

  // Cargar desde localStorage al iniciar app
  this.permisosService.cargarPermisosDesdeLocalStorage();
}
```

---

## 📝 Cómo Usar en Componentes

### Verificar Permisos en TypeScript

```typescript
export class MiComponente implements OnInit {
  constructor(private permisosService: PermisosService) {}

  ngOnInit() {
    // Opción 1: Verificar directamente
    if (this.permisosService.tienePermiso('TOURS.CREAR')) {
      console.log('Puede crear tours');
    }

    // Opción 2: Suscribirse a cambios
    this.permisosService.permisos$.subscribe(permisos => {
      this.puedeCrear = permisos.includes('TOURS.CREAR');
    });
  }
}
```

### Mostrar/Ocultar en Template

```html
<!-- Con directiva estructural -->
<button *appPermiso="'TOURS.CREAR'" (click)="crearTour()">
  Crear Tour
</button>

<!-- Con binding condicional -->
<button *ngIf="puedeCrear" (click)="crearTour()">
  Crear Tour
</button>

<!-- Con atributo disable -->
<button [disabled]="!permisosService.tienePermiso('TOURS.CREAR')">
  Crear Tour
</button>
```

---

## 🔐 Flujo de Autenticación y Permisos

```
1. Usuario inicia sesión
    ↓
2. Backend autentica y devuelve JWT con rol
    ↓
3. Frontend guarda token en localStorage
    ↓
4. App llama a obtenerMisPermisos() y obtenerMiMenu()
    ↓
5. Backend valida JWT y consulta permisos por rol
    ↓
6. Frontend recibe permisos y menú, los guarda en localStorage
    ↓
7. Componentes usan permisos para mostrar/ocultar elementos
    ↓
8. Directiva @appPermiso controla visibilidad dinámicamente
    ↓
9. DynamicNavbar muestra solo opciones accesibles
```

---

## 🛡️ Validación de Permisos

### En Backend

Toda solicitud debe pasar por:
1. **authMiddleware**: Valida JWT y extrae usuario
2. **checkPermission**: Verifica permiso específico

```javascript
// El middleware devuelve 403 si no tiene permiso
POST /api/tours
Headers: Authorization: Bearer <token>
Response: 403 Forbidden
{
  "error": "Acceso denegado",
  "mensaje": "No tiene permiso para realizar esta acción (TOURS.CREAR)",
  "permisoRequerido": "TOURS.CREAR"
}
```

---

## 📋 Permisos Disponibles por Módulo

### INICIO
- `INICIO.LEER` - Ver dashboard
- `INICIO.ACTUALIZAR_AFORO` - Modificar aforos

### RESERVAS
- `RESERVAS.CREAR` - Crear reservas
- `RESERVAS.LEER` - Ver reservas
- `RESERVAS.ACTUALIZAR` - Editar reservas
- `RESERVAS.ELIMINAR` - Eliminar reservas
- `RESERVAS.DESCARGAR` - Descargar reportes

### TOURS
- `TOURS.CREAR` - Crear tours
- `TOURS.LEER` - Ver tours
- `TOURS.ACTUALIZAR` - Editar tours
- `TOURS.ELIMINAR` - Eliminar tours
- `TOURS.DESCARGAR` - Descargar datos

### PUNTOS
- `PUNTOS.CREAR` - Crear puntos
- `PUNTOS.LEER` - Ver puntos
- `PUNTOS.ACTUALIZAR` - Editar puntos
- `PUNTOS.ELIMINAR` - Eliminar puntos
- `PUNTOS.DESCARGAR` - Descargar datos

### PROGRAMACION
- `PROGRAMACION.CREAR` - Crear programación
- `PROGRAMACION.LEER` - Ver programación
- `PROGRAMACION.ACTUALIZAR` - Editar programación
- `PROGRAMACION.ELIMINAR` - Eliminar programación
- `PROGRAMACION.DESCARGAR` - Descargar plan

### TRANSFERS
- `TRANSFERS.CREAR` - Crear transfers
- `TRANSFERS.LEER` - Ver transfers
- `TRANSFERS.ACTUALIZAR` - Editar transfers
- `TRANSFERS.ELIMINAR` - Eliminar transfers
- `TRANSFERS.DESCARGAR` - Descargar datos

### USUARIOS
- `USUARIOS.CREAR` - Crear usuarios
- `USUARIOS.LEER` - Ver usuarios
- `USUARIOS.ACTUALIZAR` - Editar usuarios
- `USUARIOS.ELIMINAR` - Eliminar usuarios
- `USUARIOS.GESTIONAR_ROLES` - Gestionar roles y permisos

### HISTORIAL
- `HISTORIAL.LEER` - Ver historial
- `HISTORIAL.DESCARGAR` - Descargar historial

### REPORTES
- `REPORTES.LEER` - Ver reportes
- `REPORTES.DESCARGAR` - Descargar reportes

---

## 🎯 Próximos Pasos

1. **Ejecutar la migración SQL** en la base de datos
2. **Reiniciar el servidor backend** (`npm run dev`)
3. **Actualizar rutas en app.ts** si tienes nuevas rutas
4. **Agregar componente DynamicNavbar** a tu layout principal
5. **Usar directiva @appPermiso** en templates para ocultar opciones
6. **Acceder a /administracion/permisos** para gestionar roles (solo admin)

---

## 🐛 Troubleshooting

### "403 Forbidden - No tiene permiso"
- ✓ Verificar que el usuario tenga el rol correcto en la BD
- ✓ Verificar que el rol tenga el permiso asignado
- ✓ Invalidar cache: `POST /api/cache/invalidar`

### Menú no se actualiza
- ✓ Verificar que `app.ts` llama a `obtenerMiMenu()` al login
- ✓ Revisar localStorage: `localStorage.getItem('user_menu')`
- ✓ Recargar página

### Permisos en caché incorrectos
- ✓ Invalidar cache manualmente desde admin o llamar: 
  ```typescript
  this.permisosService.invalidarCache(userId).subscribe(...);
  ```

---

¡Sistema RBAC completamente implementado! 🎉
