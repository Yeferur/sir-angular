import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { ActividadEntidad } from '../../services/Mercadeo/entidades-reportantes.service';
import { MercadeoReservasComponent } from './reservas/mercadeo-reservas';
import { MercadeoEntidadesComponent } from './entidades/mercadeo-entidades';

type MercadeoTab = 'entidades' | 'origen';

@Component({
  selector: 'app-mercadeo',
  standalone: true,
  imports: [CommonModule, MercadeoReservasComponent, MercadeoEntidadesComponent],
  templateUrl: './mercadeo.html',
  styleUrl: './mercadeo.css',
})
export class MercadeoComponent implements OnInit {
  private readonly permissions = inject(PermisosService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly canSeeEntities = computed(() => this.permissions.tienePermiso('ENTIDADES_REPORTANTES.LEER')
    || this.permissions.tienePermiso('ENTIDADES_REPORTANTES.VALIDAR'));
  readonly canSeeOrigin = computed(() => this.permissions.tienePermiso('MERCADEO.RESERVAS.LEER'));
  readonly activeTab = signal<MercadeoTab>('entidades');

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const requested = params.get('vista');
      const preferred: MercadeoTab = requested === 'origen' ? 'origen' : 'entidades';
      const target = this.hasPermission(preferred) ? preferred : this.firstAllowedTab();
      if (target !== this.activeTab()) this.activeTab.set(target);
      if (requested !== target) {
        void this.router.navigate([], { relativeTo: this.route, queryParams: { vista: target }, queryParamsHandling: 'merge' });
      }
    });
  }

  selectTab(tab: MercadeoTab): void {
    if (!this.hasPermission(tab)) return;
    this.activeTab.set(tab);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { vista: tab }, queryParamsHandling: 'merge' });
  }

  viewEntityOperations(entity: ActividadEntidad): void {
    if (!this.canSeeOrigin()) return;
    this.activeTab.set('origen');
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        vista: 'origen', tipo: 'TODOS', idEntidadReportante: String(entity.Id_Entidad_Reportante),
        entidadNombre: entity.Nombre, consultar: '1', page: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  private hasPermission(tab: MercadeoTab): boolean {
    return tab === 'entidades' ? this.canSeeEntities() : this.canSeeOrigin();
  }

  private firstAllowedTab(): MercadeoTab {
    return this.canSeeEntities() ? 'entidades' : 'origen';
  }
}
