import { Component, OnInit, inject, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Tours } from '../../../services/Tours/tours';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
import { ActivatedRoute, Router } from '@angular/router';
import { Reservas } from '../../../services/Reservas/reservas';

@Component({
  selector: 'app-precios-tour',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './precios.html',
  styleUrls: ['./precios.css']
})
export class PreciosTourComponent implements OnInit {
  private toursSvc = inject(Tours);
  private reservasSvc = inject(Reservas);
  private navbar = inject(DynamicIslandGlobalService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  Id_Tour = signal<number | null>(null);
  tourName = signal<string>('');
  monedas = signal<any[]>([]);
  planes = signal<any[]>([]);
  selectedMoneda = signal<number | null>(null);
  selectedPlan = signal<number | null>(null);
  loading = signal(true);
  saving = signal(false);

  precios = signal<{ ADULTO?: number | null; NINO?: number | null; INFANTE?: number | null }>({});

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id')) || null;
    this.Id_Tour.set(id);
    this.loadCatalogos();
    this.loadTourName();
  }

  loadCatalogos() {
    this.reservasSvc.getMonedas().subscribe({
      next: (m) => {
        this.monedas.set(m || []);
        // establecer por defecto Id_Moneda = 1 si existe y no hay selección
        if (!this.selectedMoneda() && this.monedas().some(x => x.Id_Moneda === 1)) {
          this.selectedMoneda.set(1);
          // carga precios tras fijar moneda por defecto
          this.loadPrecios();
        }
      },
      error: () => this.monedas.set([])
    });
    if (this.Id_Tour()) {
      this.reservasSvc.getPlanesByTour(this.Id_Tour()).subscribe({
        next: (p) => this.planes.set(p || []),
        error: () => this.planes.set([]),
        complete: () => {
          // asegurar carga de precios si aún no se cargaron
          this.loadPrecios();
        }
      });
    }
  }

  loadTourName() {
    const id = this.Id_Tour();
    if (!id) return;
    this.reservasSvc.getTours().subscribe({
      next: (rows: any[]) => {
        const t = (rows || []).find((r: any) => Number(r.Id_Tour) === Number(id));
        if (t) this.tourName.set(t.Nombre_Tour || '');
      },
      error: () => {}
    });
  }

  loadPrecios() {
    const id = this.Id_Tour();
    if (!id) return;
    this.loading.set(true);
    this.toursSvc.getPrecios({ Id_Tour: id, Id_Plan: this.selectedPlan(), Id_Moneda: this.selectedMoneda() }).subscribe({
      next: (rows: any[]) => {
        const map: any = { ADULTO: null, NINO: null, INFANTE: null };
        for (const r of rows) {
          const key = String(r.Tipo_Pasajero).toUpperCase();
          map[key] = r.Precio == null ? null : Number(r.Precio);
        }
        this.precios.set(map);
      },
      error: (err) => this.navbar.alert.set({ type: 'error', title: 'Error', message: err?.error?.message || 'No se pudieron cargar precios', autoClose: true }),
      complete: () => this.loading.set(false)
    });
  }

  onFilterChange() {
    this.loadPrecios();
  }
selectedMonedaCode() {
  const id = this.selectedMoneda();
  const m = this.monedas().find(x => x.Id_Moneda === id);
  return m?.Codigo || 'COP';
}
selectedMonedaLabel() {
  const id = this.selectedMoneda();
  const m = this.monedas().find(x => x.Id_Moneda === id);
  return m?.Nombre_Moneda || 'Moneda';
}

  updatePrecio(tipo: string, value: any) {
    const parsed = value === '' || value === null ? null : Number(value);
    const copy = { ...this.precios() };
    (copy as any)[tipo] = parsed;
    this.precios.set(copy);
  }

  async guardar() {
    const id = this.Id_Tour();
    if (!id) return;
    this.saving.set(true);
    const payload = {
      Id_Plan: this.selectedPlan() || null,
      Id_Moneda: this.selectedMoneda() || null,
      precios: this.precios()
    };
    this.toursSvc.updatePrecios(id, payload).subscribe({
      next: () => {
        this.navbar.alert.set({ type: 'success', title: 'OK', message: 'Precios guardados', autoClose: true });
        this.loadPrecios();
      },
      error: (err) => this.navbar.alert.set({ type: 'error', title: 'Error', message: err?.error?.message || 'No se pudo guardar', autoClose: true }),
      complete: () => this.saving.set(false)
    });
  }

  cancelar() {
    this.router.navigate(['/Tours/VerTours']);
  }
}
