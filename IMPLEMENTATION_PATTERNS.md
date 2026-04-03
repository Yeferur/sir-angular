# Patrones de Implementación - UX Core Refactor

Guía técnica para mantener consistencia al agregar nuevos módulos o funcionalidades.

---

## 1. Patrón Base: Component con isSubmitting + hasUnsavedChanges

### Estructura de Clase

```typescript
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { signal } from '@angular/core';
import { DynamicIslandGlobalService } from '@app/services/DynamicNavbar/global';
import { Router } from '@angular/router';
import { HasUnsavedChanges } from '@app/guards/unsaved-changes.guard';

@Component({
  selector: 'app-crear-entidad',
  templateUrl: './crear-entidad.html',
  styleUrls: ['./crear-entidad.css'],
  standalone: true,
  imports: [ReactiveFormsModule, /* otros imports */],
})
export class CrearEntidadComponent implements OnInit, HasUnsavedChanges {
  private fb = inject(FormBuilder);
  private navbar = inject(DynamicIslandGlobalService);
  private router = inject(Router);
  private service = inject(EntityService);

  form: FormGroup;
  isSubmitting = signal(false);

  ngOnInit(): void {
    this.form = this.fb.group({
      nombre: ['', [Validators.required, Validators.minLength(3)]],
      descripcion: ['', Validators.required],
      // ... más campos
    });
  }

  // Prevención de doble submit
  onSubmit(): void {
    if (this.isSubmitting()) return; // Guard #1

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.navbar.warningToast(
        'Campos inválidos',
        'Por favor revisa los errores en el formulario'
      );
      return;
    }

    this.confirmCreate();
  }

  private confirmCreate(): void {
    if (this.isSubmitting()) return; // Guard #2
    this.isSubmitting.set(true);

    this.service.crear(this.form.value).subscribe({
      next: (resp) => {
        this.navbar.successToast(
          'Entidad creada',
          \`ID: \${resp?.id || 'N/A'}\`
        );
        this.form.markAsPristine();
        this.router.navigate(['/Modulo/ListarEntidades']);
      },
      error: (err) => {
        this.navbar.errorToast(
          'Error al crear',
          err?.error?.message || 'Intenta nuevamente'
        );
      },
      complete: () => this.isSubmitting.set(false),
    });
  }

  // Requerido por guard
  hasUnsavedChanges(): boolean {
    return this.form?.dirty && !this.isSubmitting();
  }
}
```

### Template Base

```html
<form [formGroup]="form" (ngSubmit)="onSubmit()" class="form-container">
  <!-- Campo nombre -->
  <div class="form-group">
    <label for="nombre">Nombre *</label>
    <input
      id="nombre"
      type="text"
      formControlName="nombre"
      placeholder="Ingresa nombre..."
      [disabled]="isSubmitting()"
    />
    @if (form.get('nombre')?.invalid && form.get('nombre')?.touched) {
      <span class="error-message">Campo requerido, mínimo 3 caracteres</span>
    }
  </div>

  <!-- Botón envío -->
  <div class="form-actions">
    <button
      type="submit"
      [disabled]="form.invalid || isSubmitting()"
      class="btn-primary"
    >
      {{ isSubmitting() ? 'Guardando...' : 'Guardar Entidad' }}
    </button>
    <button type="button" (click)="router.navigate(['/Modulo/ListarEntidades'])">
      Cancelar
    </button>
  </div>
</form>
```

---

## 2. Patrón Listado: Optimistic UI + Confirmación Inline

### Estructura de Servicio (Optimistic helpers)

```typescript
// En service.ts
export interface Entidad {
  id: string;
  nombre: string;
  estado: string;
  // ... propiedades
}

export class EntityService {
  private entidades = signal<Entidad[]>([]);

  removeEntidadFromSignal(id: string): {
    entity: Entidad | null;
    index: number;
  } {
    const current = this.entidades();
    const index = current.findIndex((e) => String(e.id) === String(id));
    if (index < 0) return { entity: null, index: -1 };

    const entity = current[index];
    this.entidades.update((list) => list.filter((e) => String(e.id) !== String(id)));
    return { entity, index };
  }

  restoreEntidadInSignal(entity: Entidad, index = -1): void {
    this.entidades.update((list) => {
      const next = [...list];
      if (index >= 0) next.splice(index, 0, entity);
      else next.push(entity);
      return next;
    });
  }

  eliminar(id: string) {
    return this.http.delete(\`/api/entidades/\${id}\`);
  }
}
```

### Estructura de Listado (Component)

```typescript
export class ListarEntidadesComponent {
  private service = inject(EntityService);
  private navbar = inject(DynamicIslandGlobalService);

  entidades = this.service.entidades; // Signal

  confirmEliminar(id: string): void {
    const removed = this.service.removeEntidadFromSignal(id);
    this.navbar.infoToast('Eliminando...', 'Un momento', 1500);

    this.service.eliminar(id).subscribe({
      next: () => {
        this.navbar.successToast('Eliminada', 'Entidad removida correctamente');
      },
      error: (err) => {
        this.service.restoreEntidadInSignal(removed.entity!, removed.index);
        this.navbar.errorToast('Error', err?.error?.message || '...');
      },
    });
  }
}
```

---

## 3. Patrón Carga Progresiva: Catálogos Independientes

### Caso: Usuarios con Roles y Permisos

```typescript
export class CrearUsuarioComponent implements OnInit, HasUnsavedChanges {
  // Separar catalogLoading de isSubmitting
  catalogLoading = signal(false);
  isSubmitting = signal(false);
  
  roles = signal<Rol[]>([]);
  permisos = signal<Permiso[]>([]);

  ngOnInit(): void {
    this.form = this.fb.group({
      nombre: ['', Validators.required],
      roleId: ['', Validators.required], // Select disabled mientras carga
      permisosIds: [[], Validators.required],
    });

    // Cargas NO bloqueantes
    this.loadCatalogs();
  }

  private loadCatalogs(): void {
    this.catalogLoading.set(true);

    forkJoin({
      roles: this.service.obtenerRoles(),
      permisos: this.service.obtenerPermisos(),
    }).subscribe({
      next: (data) => {
        this.roles.set(data.roles);
        this.permisos.set(data.permisos);
      },
      error: () => {
        this.navbar.warningToast(
          'Catálogos no disponibles',
          'Recarga o usa valores por defecto'
        );
      },
      complete: () => this.catalogLoading.set(false),
    });
  }

  hasUnsavedChanges(): boolean {
    return this.form?.dirty && !this.isSubmitting();
  }
}
```

### Template con Carga Progresiva

```html
<form [formGroup]="form">
  <!-- Nombre (siempre visible) -->
  <input formControlName="nombre" placeholder="Nombre..." />

  <!-- Roles (selectores deshabilitados mientras cargan) -->
  <div class="form-group">
    <label>Rol * 
      @if (catalogLoading()) {
        <small>(cargando...)</small>
      }
    </label>
    <select 
      formControlName="roleId" 
      [disabled]="catalogLoading() || isSubmitting()"
    >
      @for (rol of roles(); track rol.id) {
        <option [value]="rol.id">{{ rol.nombre }}</option>
      }
    </select>
  </div>

  <!-- Permisos (checkboxes deshabilitados mientras cargan) -->
  <div class="form-group">
    <label>Permisos
      @if (catalogLoading()) {
        <small>(cargando...)</small>
      }
    </label>
    <div class="permission-list">
      @for (permiso of permisos(); track permiso.id) {
        <label>
          <input
            type="checkbox"
            [formControl]="getPermissionControl(permiso.id)"
            [disabled]="catalogLoading() || isSubmitting()"
          />
          {{ permiso.nombre }}
        </label>
      }
    </div>
  </div>

  <button [disabled]="form.invalid || isSubmitting() || catalogLoading()">
    {{ isSubmitting() ? 'Guardando...' : 'Crear Usuario' }}
  </button>
</form>
```

---

## 4. Sistema de Toasts: Jerarquía de Duración

```typescript
// En global.ts - DynamicIslandGlobalService

successToast(title: string, message = '', durationMs: number = 3000): string {
  // Para operaciones exitosas rápidas: 3s
  return this.showToast({ type: 'success', title, message, durationMs });
}

infoToast(title: string, message = '', durationMs: number = 3000): string {
  // Para información contextual: 3s
  return this.showToast({ type: 'info', title, message, durationMs });
}

warningToast(title: string, message = '', durationMs: number = 3500): string {
  // Para advertencias y validaciones: 3.5s (más tiempo para leer)
  return this.showToast({ type: 'warning', title, message, durationMs });
}

errorToast(title: string, message = '', durationMs: number = 4500): string {
  // Para errores críticos: 4.5s (máximo tiempo)
  return this.showToast({ type: 'error', title, message, durationMs });
}
```

**Guía de Uso**:
- `successToast`: Confirmación de operación completada
- `infoToast`: Indicador de proceso en curso (Optimistic UI - muy breve: 1500ms)
- `warningToast`: Validación fallida, duplicado detectado, acción requiere atención
- `errorToast`: Fallo de API, pérdida de conectividad, acción no permitida

---

## 5. Integración en Rutas: Guard Assignment

```typescript
// app.routes.ts
import { unsavedChangesGuard } from './guards/unsaved-changes.guard';

export const routes: Route[] = [
  {
    path: 'Modulo/NuevaEntidad',
    loadComponent: () =>
      import('./pages/Modulo/crear/crear.component').then(
        (m) => m.CrearComponent
      ),
    canDeactivate: [unsavedChangesGuard], // ← Añadir aquí
    title: 'SIR · Nueva Entidad',
  },
  {
    path: 'Modulo/Editar/:id',
    loadComponent: () =>
      import('./pages/Modulo/editar/editar.component').then(
        (m) => m.EditarComponent
      ),
    canDeactivate: [unsavedChangesGuard], // ← Añadir aquí
    title: 'SIR · Editar Entidad',
  },
  // ... más rutas
];
```

---

## 6. Validación Inline: Sin Modales Confirmación

### Patrón: Validación → Toast → Ejecución Directa

```typescript
// Ejemplo: Confirmar eliminación sin modal

confirmDeleteMultiple(ids: string[]): void {
  if (!ids.length) {
    this.navbar.warningToast('Sin selección', 'Selecciona al menos un item');
    return;
  }

  // Aquí: usuario ya hizo click explícito en botón DELETE
  // No necesitamos modal extra; ya tiene contexto visual

  this.navbar.infoToast('Eliminando ' + ids.length + ' items...', '', 2000);

  forkJoin(ids.map((id) => this.service.eliminar(id))).subscribe({
    next: () => {
      this.navbar.successToast('Éxito', \`Se eliminaron \${ids.length} items\`);
      this.refreshList();
    },
    error: (err) => {
      this.navbar.errorToast('Error parcial', 'Algunos items no se pudieron eliminar');
    },
  });
}
```

---

## 7. Checklist de Implementación para Nuevo Módulo

- [ ] Service: añadir `remover*FromSignal()` + `restaurar*InSignal()` si aplica
- [ ] Component crear: `isSubmitting`, `hasUnsavedChanges()`, toasts, `form.markAsPristine()`
- [ ] Component editar: idem crear
- [ ] Template: `[disabled]="isSubmitting()"` en form, botón muestra "Guardando..."
- [ ] Routes: añadir `canDeactivate: [unsavedChangesGuard]` a rutas de formulario
- [ ] Alert → Toast: reemplazar `navbar.alert.set()` con `navbar.successToast()` / `errorToast()`
- [ ] Modales confirmación: → toasts + validación inline
- [ ] setTimeout navegación: → `router.navigate()` inmediato
- [ ] Validación: → `warningToast` si inválido, no bloquee con modal
- [ ] Test: verificar guard pregunta al salir sin guardar

---

## 8. Troubleshooting Común

### Toast no cierra tras duración

**Causa**: durationMs muy bajo (< 1000ms)  
**Solución**: 
```typescript
// En showToast()
const safeDuration = Math.max(1000, Number(toast.durationMs || 3500));
```

### Guard no funciona

**Causa**: Componente no implementa `HasUnsavedChanges`  
**Solución**: Añadir interfaz + método:
```typescript
export class MyComponent implements HasUnsavedChanges {
  hasUnsavedChanges(): boolean {
    return this.form?.dirty && !this.isSubmitting();
  }
}
```

### Doble submit sigue ocurriendo

**Causa**: Button no está disabled en template  
**Solución**:
```html
<button [disabled]="form.invalid || isSubmitting()">
  {{ isSubmitting() ? 'Guardando...' : 'Guardar' }}
</button>
```

### Catálogos bloquean formulario

**Causa**: Usar único `isLoading` para catálogos + guardar  
**Solución**: Separar en `catalogLoading` e `isSubmitting`:
```typescript
<select [disabled]="catalogLoading() || isSubmitting()"> ... </select>
<button [disabled]="isSubmitting()"> ... </button>
```

---

*Documento mantenido actualizado con cada nueva incorporación de módulos.*
