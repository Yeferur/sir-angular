# ⚡ GUÍA RÁPIDA: Activar RBAC en 5 Pasos

## Paso 1: Ejecutar Migración SQL (5 minutos)

### Opción A: Desde Terminal MySQL
```bash
cd backend/database/migrations
mysql -u root -p nombre_de_tu_bd < 001_rbac_permissions.sql
```

### Opción B: Desde phpMyAdmin
1. Abrir phpMyAdmin
2. Ir a tu base de datos
3. Click en "SQL"
4. Copiar contenido de `001_rbac_permissions.sql`
5. Pegar y ejecutar

### Verificar
```sql
-- En MySQL, ejecutar:
SELECT COUNT(*) FROM roles;           -- Debe devolver 5
SELECT COUNT(*) FROM permisos;        -- Debe devolver 27
SELECT COUNT(*) FROM modulos;         -- Debe devolver 9
```

**✅ Paso 1 completado**

---

## Paso 2: Verificar Estructura Backend (2 minutos)

Los archivos ya están en el lugar correcto:
```
✅ backend/services/Permisos/permisos.service.js
✅ backend/middlewares/permissionsMiddleware.js
✅ backend/controllers/Permisos/permisos.controller.js
✅ backend/routes/Permisos/permisos.routes.js
✅ backend/server.js (ya actualizado)
✅ Todas las rutas protegidas
```

**✅ Paso 2 completado**

---

## Paso 3: Verificar Estructura Frontend (2 minutos)

Los archivos ya están en el lugar correcto:
```
✅ frontend/src/app/services/Permisos/permisos.service.ts
✅ frontend/src/app/shared/directives/permiso.directive.ts
✅ frontend/src/app/shared/components/dynamic-navbar/
✅ frontend/src/app/pages/Administracion/permissions-admin/
✅ frontend/src/app/pages/Administracion/my-permissions/
✅ frontend/src/app/app.ts (ya actualizado)
```

**✅ Paso 3 completado**

---

## Paso 4: Agregar Rutas en app.routes.ts (3 minutos)

Abrir `frontend/src/app/app.routes.ts` y agregar:

```typescript
import { PermissionsAdminComponent } from './pages/Administracion/permissions-admin/permissions-admin.component';
import { MyPermissionsComponent } from './pages/Administracion/my-permissions/my-permissions.component';

export const routes: Routes = [
  // ... tus rutas existentes ...

  // ⬇️ AGREGAR ESTAS RUTAS:
  {
    path: 'administracion/permisos',
    component: PermissionsAdminComponent,
    canActivate: [authGuard]  // O tu guard de autenticación
  },
  {
    path: 'mis-permisos',
    component: MyPermissionsComponent,
    canActivate: [authGuard]
  },
  {
    path: 'perfil',
    component: TuComponentePerfil,  // Reemplazar con componente existente
    canActivate: [authGuard]
  }
];
```

**✅ Paso 4 completado**

---

## Paso 5: Integrar en Layout Principal (3 minutos)

### Opción A: Si tienes layout separado

Reemplazar tu navbar anterior por:
```html
<app-dynamic-navbar></app-dynamic-navbar>
```

### Opción B: En app.html (si no hay layout separado)

```html
<!-- app.html -->
<app-dynamic-navbar *ngIf="loggedIn"></app-dynamic-navbar>
<router-outlet></router-outlet>
```

Asegúrate de importar en `app.ts`:
```typescript
import { DynamicNavbarComponent } from './shared/components/dynamic-navbar/dynamic-navbar.component';
import { PermisosService } from './services/Permisos/permisos.service';

@Component({
  imports: [DynamicNavbarComponent, ...],  // ← Agregar DynamicNavbarComponent
  ...
})
export class App implements OnInit {
  constructor(
    private permisosService: PermisosService,  // ← Agregar
    ...
  ) {}
}
```

**✅ Paso 5 completado**

---

## 🎯 ¡Listo! Ahora usa RBAC en tu app

### En Templates:
```html
<!-- Mostrar solo si tiene permiso -->
<button *appPermiso="'TOURS.CREAR'">Crear Tour</button>

<!-- Si tiene al menos uno -->
<div *appPermiso="['TOURS.LEER', 'RESERVAS.LEER']">
  Ver datos
</div>

<!-- Si tiene todos -->
<div *appPermiso="['TOURS.CREAR', 'TOURS.ACTUALIZAR']; requireAll: true">
  Gestionar tours
</div>
```

### En TypeScript:
```typescript
import { PermisosService } from './services/Permisos/permisos.service';

export class MiComponente {
  constructor(private permisosService: PermisosService) {}

  ngOnInit() {
    // Verificar permiso
    if (this.permisosService.tienePermiso('TOURS.CREAR')) {
      console.log('Puede crear tours');
    }

    // Suscribirse a cambios
    this.permisosService.permisos$.subscribe(permisos => {
      // actualizar componente
    });
  }
}
```

---

## 🧪 Testing

### 1. Iniciar sesión como Administrador
```
Usuario: tu_admin
Contraseña: tu_password
```

### 2. Verifica que:
- ✅ Ves todos los módulos en la navbar
- ✅ Aparece botón "Administración" en navbar
- ✅ Puedes acceder a `/administracion/permisos`
- ✅ Ves todos los roles y permisos

### 3. Iniciar sesión como Asesor
```
Usuario: un_asesor
Contraseña: su_password
```

### 4. Verifica que:
- ✅ Solo ves Reservas, Tours, Puntos en navbar
- ✅ NO aparece botón "Administración"
- ✅ NO puedes acceder a `/administracion/permisos` (error 403)
- ✅ Los botones de crear/editar están disponibles

### 5. Iniciar sesión como Consultor
```
Usuario: un_consultor
Contraseña: su_password
```

### 6. Verifica que:
- ✅ Ves módulos pero NO botones de crear/editar
- ✅ Solo puedes leer información

---

## 🔧 Troubleshooting

### "Error: Cannot find module 'permisos.service'"
**Solución**: Verificar que la ruta en los imports sea correcta:
```typescript
import { PermisosService } from '../../services/Permisos/permisos.service';
//                           ↑
//                     Ruta relativa correcta
```

### "403 Forbidden - No tiene permiso"
**Solución**: 
1. Verificar que el usuario tiene el rol correcto en BD:
   ```sql
   SELECT * FROM usuarios WHERE Usuario = 'miusuario';
   -- Verifica que Id_Rol no sea NULL
   ```

2. Verificar que el rol tiene el permiso:
   ```sql
   SELECT p.* FROM rol_permisos rp
   JOIN permisos p ON rp.Id_Permiso = p.Id_Permiso
   WHERE rp.Id_Rol = 2;  -- ID del rol
   ```

3. Invalidar cache:
   ```bash
   POST /api/cache/invalidar
   ```

### "Menú no se actualiza"
**Solución**:
1. Recargar página
2. Verificar localStorage:
   ```javascript
   // En consola del navegador:
   localStorage.getItem('user_menu')
   localStorage.getItem('user_permissions')
   ```

3. Si está vacío, invalidar cache:
   ```bash
   POST /api/cache/invalidar { userId: 123 }
   ```

### "Rutas protegidas devuelven 500"
**Solución**:
1. Revisar logs del backend: `npm run dev`
2. Verificar que authMiddleware devuelve `req.user`:
   ```javascript
   // En backend/middlewares/authMiddleware.js
   req.user debe tener: { id, username, name, email, role }
   ```

---

## 📚 Documentación Adicional

- **Guía Completa**: [RBAC_IMPLEMENTATION_GUIDE.md](RBAC_IMPLEMENTATION_GUIDE.md)
- **Status de Implementación**: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)
- **Ejemplos de Uso**: [RBAC_USAGE_EXAMPLES.md](RBAC_USAGE_EXAMPLES.md)
- **Resumen Visual**: [RBAC_SUMMARY.md](RBAC_SUMMARY.md)

---

## 🎉 ¿Listo?

```
✅ Base de datos actualizada
✅ Backend con permisos
✅ Frontend con componentes
✅ Rutas protegidas
✅ Directiva @appPermiso lista
✅ Admin UI lista
✅ Navbar dinámico ready

→ ¡Comienza a usar RBAC ahora!
```

---

## ⏱️ Tiempo Total: ~15 minutos

1. Migración SQL: 5 min
2. Verificar archivos: 2 min
3. Agregar rutas: 3 min
4. Integrar navbar: 3 min
5. Testing: 2 min

**Total: 15 minutos para activar el sistema completo**

---

## 📞 Soporte Rápido

### ¿Cómo agregar nuevo permiso?
```sql
INSERT INTO permisos (Id_Modulo, Accion, Codigo_Permiso, Descripcion)
VALUES (1, 'EXPORTAR', 'TOURS.EXPORTAR', 'Exportar tours a Excel');

-- Asignar a rol Administrador
INSERT INTO rol_permisos (Id_Rol, Id_Permiso)
SELECT 1, Id_Permiso FROM permisos WHERE Codigo_Permiso = 'TOURS.EXPORTAR';
```

### ¿Cómo cambiar rol de usuario?
```sql
UPDATE usuarios SET Id_Rol = 2 WHERE Usuario = 'asesor1';
-- 1=Admin, 2=Asesor, 3=Consultor, 4=Operador, 5=SoloLectura
```

### ¿Cómo invalidar cache?
```bash
curl -X POST http://localhost:4000/api/cache/invalidar \
  -H "Authorization: Bearer TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": null}'
```

---

**¿Todo listo? ¡Accede a `/administracion/permisos` para empezar!** 🚀
