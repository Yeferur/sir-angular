import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { PermisosService, Rol, Modulo, PermisoCompleto } from '../../../services/Permisos/permisos.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-permissions-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="container mt-4">
      <h1>Administración de Permisos y Roles</h1>

      <!-- Tabs para navegación -->
      <ul class="nav nav-tabs mb-4" role="tablist">
        <li class="nav-item">
          <a class="nav-link" [class.active]="tabActivo === 'roles'" (click)="tabActivo = 'roles'">
            Gestionar Roles
          </a>
        </li>
        <li class="nav-item">
          <a class="nav-link" [class.active]="tabActivo === 'permisos'" (click)="tabActivo = 'permisos'">
            Asignar Permisos
          </a>
        </li>
      </ul>

      <!-- TAB: GESTIONAR ROLES -->
      <div *ngIf="tabActivo === 'roles'" class="tab-pane active">
        <div class="row">
          <div class="col-md-6">
            <h3>Lista de Roles</h3>
            <div class="list-group">
              <button 
                *ngFor="let rol of roles; let i = index" 
                class="list-group-item list-group-item-action"
                [class.active]="rolSeleccionado?.Id_Rol === rol.Id_Rol"
                (click)="seleccionarRol(rol)"
              >
                <strong>{{ rol.Nombre_Rol }}</strong>
                <small class="d-block text-muted">{{ rol.Descripcion }}</small>
              </button>
            </div>
          </div>

          <div class="col-md-6">
            <h3>Detalles del Rol</h3>
            <form *ngIf="rolSeleccionado" [formGroup]="formRol" (ngSubmit)="guardarRol()">
              <div class="mb-3">
                <label class="form-label">Nombre del Rol</label>
                <input type="text" class="form-control" formControlName="nombreRol" />
              </div>

              <div class="mb-3">
                <label class="form-label">Descripción</label>
                <textarea class="form-control" formControlName="descripcion" rows="3"></textarea>
              </div>

              <div class="mb-3">
                <label class="form-check-label">
                  <input type="checkbox" class="form-check-input" formControlName="activo" />
                  Activo
                </label>
              </div>

              <button type="submit" class="btn btn-primary" [disabled]="!formRol.valid || cargando">
                {{ cargando ? 'Guardando...' : 'Guardar Cambios' }}
              </button>
              <button type="button" class="btn btn-danger ms-2" (click)="eliminarRol()" [disabled]="cargando">
                Eliminar
              </button>
            </form>

            <!-- Formulario crear nuevo rol -->
            <form *ngIf="!rolSeleccionado" [formGroup]="formNuevoRol" (ngSubmit)="crearRol()" class="mt-4 p-3 bg-light rounded">
              <h5>Crear Nuevo Rol</h5>
              <div class="mb-3">
                <label class="form-label">Nombre del Rol</label>
                <input type="text" class="form-control" formControlName="nombreRol" />
              </div>

              <div class="mb-3">
                <label class="form-label">Descripción</label>
                <textarea class="form-control" formControlName="descripcion" rows="2"></textarea>
              </div>

              <button type="submit" class="btn btn-success" [disabled]="!formNuevoRol.valid || cargando">
                {{ cargando ? 'Creando...' : 'Crear Rol' }}
              </button>
            </form>
          </div>
        </div>
      </div>

      <!-- TAB: ASIGNAR PERMISOS -->
      <div *ngIf="tabActivo === 'permisos'" class="tab-pane active">
        <div class="row">
          <div class="col-md-4">
            <h4>Seleccionar Rol</h4>
            <select class="form-select" [(ngModel)]="rolSeleccionadoPermisos" (change)="cargarPermisosRol()">
              <option value="">-- Selecciona un rol --</option>
              <option *ngFor="let rol of roles" [value]="rol.Id_Rol">
                {{ rol.Nombre_Rol }}
              </option>
            </select>
          </div>
        </div>

        <div class="row mt-4" *ngIf="rolSeleccionadoPermisos">
          <div class="col-md-6">
            <h4>Permisos Disponibles</h4>
            <div class="mb-3">
              <input 
                type="text" 
                class="form-control" 
                placeholder="Buscar permisos..."
                [(ngModel)]="buscarPermiso"
              />
            </div>
            <div class="list-group" style="max-height: 400px; overflow-y: auto;">
              <div 
                *ngFor="let permiso of permisosDisponibles"
                class="list-group-item d-flex justify-content-between align-items-center"
              >
                <div>
                  <strong>{{ permiso.Codigo_Permiso }}</strong>
                  <small class="d-block text-muted">{{ permiso.Descripcion }}</small>
                </div>
                <button 
                  class="btn btn-sm btn-success"
                  (click)="asignarPermiso(permiso.Id_Permiso)"
                  [disabled]="tienePermiso(permiso.Id_Permiso) || cargando"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div class="col-md-6">
            <h4>Permisos Asignados</h4>
            <div class="list-group" style="max-height: 400px; overflow-y: auto;">
              <div 
                *ngFor="let permiso of permisosAsignados"
                class="list-group-item d-flex justify-content-between align-items-center"
              >
                <div>
                  <strong>{{ permiso.Codigo_Permiso }}</strong>
                  <small class="d-block text-muted">{{ permiso.Descripcion }}</small>
                </div>
                <button 
                  class="btn btn-sm btn-danger"
                  (click)="revocarPermiso(permiso.Id_Permiso)"
                  [disabled]="cargando"
                >
                  -
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Mensaje de éxito/error -->
      <div class="alert alert-success mt-4" *ngIf="mensaje && !esError">
        {{ mensaje }}
      </div>
      <div class="alert alert-danger mt-4" *ngIf="mensaje && esError">
        {{ mensaje }}
      </div>
    </div>
  `,
  styles: [`
    .container {
      max-width: 1000px;
    }

    .nav-tabs .nav-link {
      cursor: pointer;
      color: #495057;
    }

    .nav-tabs .nav-link.active {
      color: #0d6efd;
      border-bottom: 2px solid #0d6efd;
    }

    .list-group-item {
      cursor: pointer;
    }

    .list-group-item.active {
      background-color: #0d6efd;
      border-color: #0d6efd;
    }

    .tab-pane {
      animation: fadeIn 0.3s ease-in;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
  `]
})
export class PermissionsAdminComponent implements OnInit, OnDestroy {
  tabActivo: 'roles' | 'permisos' = 'roles';
  roles: Rol[] = [];
  modulos: Modulo[] = [];
  todosPermisos: PermisoCompleto[] = [];
  
  rolSeleccionado: Rol | null = null;
  rolSeleccionadoPermisos: any = '';
  
  permisosAsignados: PermisoCompleto[] = [];
  buscarPermiso = '';
  
  formRol: FormGroup;
  formNuevoRol: FormGroup;
  
  cargando = false;
  mensaje = '';
  esError = false;
  
  private destroy$ = new Subject<void>();

  constructor(
    private permisosService: PermisosService,
    private fb: FormBuilder
  ) {
    this.formRol = this.fb.group({
      nombreRol: ['', Validators.required],
      descripcion: [''],
      activo: [true]
    });

    this.formNuevoRol = this.fb.group({
      nombreRol: ['', Validators.required],
      descripcion: ['']
    });
  }

  ngOnInit() {
    this.cargarDatos();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  cargarDatos() {
    this.cargando = true;

    this.permisosService.obtenerRoles()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.roles = response.roles;
          this.cargando = false;
        },
        error: (err) => {
          this.mostrarError('Error al cargar roles');
          this.cargando = false;
        }
      });

    this.permisosService.obtenerModulos()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.modulos = response.modulos;
        },
        error: () => this.mostrarError('Error al cargar módulos')
      });

    this.permisosService.obtenerPermisos()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.todosPermisos = response.permisos;
        },
        error: () => this.mostrarError('Error al cargar permisos')
      });
  }

  seleccionarRol(rol: Rol) {
    this.rolSeleccionado = rol;
    this.formRol.patchValue({
      nombreRol: rol.Nombre_Rol,
      descripcion: rol.Descripcion,
      activo: rol.Activo === 1
    });
  }

  guardarRol() {
    if (!this.rolSeleccionado || !this.formRol.valid) {
      return;
    }

    this.cargando = true;
    const { nombreRol, descripcion, activo } = this.formRol.value;

    this.permisosService.actualizarRol(
      this.rolSeleccionado.Id_Rol,
      nombreRol,
      descripcion,
      activo ? 1 : 0
    ).pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.mostrarExito('Rol actualizado correctamente');
          this.cargarDatos();
          this.rolSeleccionado = null;
          this.cargando = false;
        },
        error: () => {
          this.mostrarError('Error al actualizar rol');
          this.cargando = false;
        }
      });
  }

  crearRol() {
    if (!this.formNuevoRol.valid) {
      return;
    }

    this.cargando = true;
    const { nombreRol, descripcion } = this.formNuevoRol.value;

    this.permisosService.crearRol(nombreRol, descripcion)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.mostrarExito('Rol creado correctamente');
          this.formNuevoRol.reset();
          this.cargarDatos();
          this.cargando = false;
        },
        error: () => {
          this.mostrarError('Error al crear rol');
          this.cargando = false;
        }
      });
  }

  eliminarRol() {
    if (!this.rolSeleccionado) {
      return;
    }

    if (!confirm('¿Está seguro de que desea eliminar este rol?')) {
      return;
    }

    this.cargando = true;
    this.permisosService.eliminarRol(this.rolSeleccionado.Id_Rol)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.mostrarExito('Rol eliminado correctamente');
          this.rolSeleccionado = null;
          this.cargarDatos();
          this.cargando = false;
        },
        error: (err) => {
          this.mostrarError(err.error?.mensaje || 'Error al eliminar rol');
          this.cargando = false;
        }
      });
  }

  cargarPermisosRol() {
    if (!this.rolSeleccionadoPermisos) {
      this.permisosAsignados = [];
      return;
    }

    this.cargando = true;
    this.permisosService.obtenerPermisosPorRol(this.rolSeleccionadoPermisos)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.permisosAsignados = response.permisos;
          this.cargando = false;
        },
        error: () => {
          this.mostrarError('Error al cargar permisos del rol');
          this.cargando = false;
        }
      });
  }

  asignarPermiso(idPermiso: number) {
    if (!this.rolSeleccionadoPermisos) {
      return;
    }

    this.cargando = true;
    this.permisosService.asignarPermiso(this.rolSeleccionadoPermisos, idPermiso)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.mostrarExito('Permiso asignado');
          this.cargarPermisosRol();
          this.cargando = false;
        },
        error: () => {
          this.mostrarError('Error al asignar permiso');
          this.cargando = false;
        }
      });
  }

  revocarPermiso(idPermiso: number) {
    if (!this.rolSeleccionadoPermisos) {
      return;
    }

    this.cargando = true;
    this.permisosService.revocarPermiso(this.rolSeleccionadoPermisos, idPermiso)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.mostrarExito('Permiso revocado');
          this.cargarPermisosRol();
          this.cargando = false;
        },
        error: () => {
          this.mostrarError('Error al revocar permiso');
          this.cargando = false;
        }
      });
  }

  get permisosDisponibles(): PermisoCompleto[] {
    const permisosAsignadosIds = this.permisosAsignados.map(p => p.Id_Permiso);
    return this.todosPermisos.filter(p => 
      !permisosAsignadosIds.includes(p.Id_Permiso) &&
      p.Codigo_Permiso.toLowerCase().includes(this.buscarPermiso.toLowerCase())
    );
  }

  tienePermiso(idPermiso: number): boolean {
    return this.permisosAsignados.some(p => p.Id_Permiso === idPermiso);
  }

  private mostrarExito(mensaje: string) {
    this.mensaje = mensaje;
    this.esError = false;
    setTimeout(() => {
      this.mensaje = '';
    }, 3000);
  }

  private mostrarError(mensaje: string) {
    this.mensaje = mensaje;
    this.esError = true;
    setTimeout(() => {
      this.mensaje = '';
    }, 5000);
  }
}
