import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PermisosService, Permiso } from '../../../services/Permisos/permisos.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-my-permissions',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="container mt-4">
      <h1>Mis Permisos</h1>

      <div class="alert alert-info" *ngIf="!permisos.length">
        Cargando permisos...
      </div>

      <div *ngIf="permisos.length > 0">
        <!-- Agrupar por módulo -->
        <div *ngFor="let grupo of permisosAgrupados" class="card mb-3">
          <div class="card-header bg-primary text-white">
            <strong>{{ grupo.nombreModulo }}</strong>
            <span class="badge bg-light text-dark float-end">{{ grupo.permisos.length }} permisos</span>
          </div>
          <div class="card-body">
            <div class="row">
              <div *ngFor="let permiso of grupo.permisos" class="col-md-6 col-lg-4 mb-2">
                <span class="badge bg-success">{{ permiso.accion }}</span>
                <small class="d-block text-muted">{{ permiso.descripcion }}</small>
              </div>
            </div>
          </div>
        </div>

        <div class="mt-4 p-3 bg-light rounded">
          <small>
            <strong>Total:</strong> {{ totalPermisos }} permisos en {{ permisosAgrupados.length }} módulos
          </small>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .container {
      max-width: 900px;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .badge {
      margin-right: 0.5rem;
      margin-bottom: 0.5rem;
    }

    .card-body {
      padding-top: 1.5rem;
    }
  `]
})
export class MyPermissionsComponent implements OnInit, OnDestroy {
  permisos: Permiso[] = [];
  permisosAgrupados: any[] = [];
  totalPermisos = 0;
  private destroy$ = new Subject<void>();

  constructor(private permisosService: PermisosService) {}

  ngOnInit() {
    this.cargarPermisos();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  cargarPermisos() {
    this.permisosService.obtenerMisPermisos()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.permisos = response.permisos;
          this.totalPermisos = this.permisos.length;
          this.agruparPermisos();
        },
        error: (err) => {
          console.error('Error cargando permisos:', err);
        }
      });
  }

  private agruparPermisos() {
    const grupos = new Map<string, any>();

    this.permisos.forEach(permiso => {
      if (!grupos.has(permiso.modulo)) {
        grupos.set(permiso.modulo, {
          modulo: permiso.modulo,
          nombreModulo: permiso.nombreModulo,
          permisos: []
        });
      }

      grupos.get(permiso.modulo).permisos.push(permiso);
    });

    this.permisosAgrupados = Array.from(grupos.values())
      .sort((a, b) => a.nombreModulo.localeCompare(b.nombreModulo));
  }
}
