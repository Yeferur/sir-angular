import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject, effect, Injector } from '@angular/core';
import { InicioService, Tour, Transfer } from '../../services/inicio';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';

@Component({
  selector: 'app-inicio',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './inicio.html',
  styleUrl: './inicio.css',
})
export class Inicio implements OnInit {
  private inicioService = inject(InicioService);
  private cdr = inject(ChangeDetectorRef);
  private global = inject(DynamicIslandGlobalService);
  private injector = inject(Injector);

  editando: { [key: number]: boolean } = {};
  nuevoCupo: { [key: number]: string } = {};
  mostrarDetallesCombinada = false;
  isLoading = false;

  fecha: string = new Date().toISOString().split('T')[0];

  tours: Tour[] = [];
  transfers: Transfer[] = [];

  combinedTour: Tour | null = null;
  combinedDetails: Tour[] = [];

  // evita recargas duplicadas
  private loading = false;

  constructor() {
    // ✅ Aforo en tiempo real: actualiza estado local (NO HTTP)
    effect(() => {
      const aforo = this.inicioService.aforoActualizado();
      if (!aforo) return;

      const id = Number(aforo.Id_Tour);
      const nuevo = Number(aforo.NuevoCupo);

      // actualiza tours
      const t = this.tours.find(x => x.Id_Tour === id);
      if (t) t.cupos = nuevo;

      // actualiza combinado (si es el 5)
      if (this.combinedTour && id === 5) {
        this.combinedTour.cupos = nuevo;
      }

      // si estaba editando ese tour, refresca input
      if (this.editando[id]) {
        this.nuevoCupo[id] = String(nuevo);
      }

      // zoneless friendly
      this.cdr.markForCheck();
    }, { injector: this.injector });

    // ✅ Reservas en tiempo real: aquí sí conviene recargar (porque afectan contadores)
    // Pero hazlo "deferred" para evitar NG0100 si llega durante render.
    effect(() => {
      const reserva = this.inicioService.reservaActualizada();
      if (!reserva) return;

      if (reserva.Fecha_Tour === this.fecha) {
        queueMicrotask(() => this.loadData());
      }
    }, { injector: this.injector });
  }

  ngOnInit(): void {
    this.loadData();
  }

  onFechaChange(event: Event) {
    this.fecha = (event.target as HTMLInputElement).value;
    this.loadData();
  }

  loadData() {
    if (this.loading) return;
    this.loading = true;

    this.inicioService.getDatosInicio(this.fecha).subscribe({
      next: (data) => {
        this.tours = data.tours;
        this.transfers = data.transfers;

        const tour1 = data.tours.find((t) => t.Id_Tour === 1);
        const tour5 = data.tours.find((t) => t.Id_Tour === 5);

        if (tour1 && tour5) {
          this.combinedTour = {
            Id_Tour: tour5.Id_Tour,
            Nombre_Tour: `${tour1.Nombre_Tour} Y ${tour5.Nombre_Tour}`,
            NumeroPasajeros: (tour1.NumeroPasajeros || 0) + (tour5.NumeroPasajeros || 0),
            cupos: Number(tour5.cupos) || 0,
            totalPrivados: (tour1.totalPrivados || 0) + (tour5.totalPrivados || 0),
            privados: [],
          };
          this.combinedDetails = [tour1, tour5];
        } else {
          this.combinedTour = null;
          this.combinedDetails = [];
        }

        // ✅ NO detectChanges() en zoneless
        this.cdr.markForCheck();
      },
      error: () => {
        this.cdr.markForCheck();
      },
      complete: () => {
        this.loading = false;
      }
    });
  }

  getCardColor(pasajeros: number, cupos: number): string {
    const safeCupos = cupos > 0 ? cupos : 1;
    const usage = (pasajeros / safeCupos) * 100;
    if (usage < 30) return 'green';
    if (usage < 60) return 'blue';
    if (usage < 90) return 'yellow';
    return 'red';
  }

  trackByTourId(index: number, tour: any): number {
    return tour.Id_Tour;
  }

  get toursConPrivados(): Tour[] {
    return this.tours.filter(t => t.privados && t.privados.length > 0);
  }

  alternarDetallesCombinada() {
    this.mostrarDetallesCombinada = !this.mostrarDetallesCombinada;
    this.editando[5] = false;
  }

  activarEdicion(id: number) {
    this.editando[id] = true;

    const tour =
      id === 5 && this.combinedTour
        ? this.combinedTour
        : this.tours.find((t) => t.Id_Tour === id);

    this.nuevoCupo[id] = tour?.cupos?.toString() || '';
    this.cdr.markForCheck();
  }

  guardarAforo(tour: Tour) {
    const cupo = this.nuevoCupo[tour.Id_Tour];
    if (!cupo || isNaN(+cupo)) {
      this.global.alert.set({
        type: 'error',
        title: 'Dato inválido',
        message: 'Debes ingresar un número válido de cupos.',
        autoClose: true,
      });
      return;
    }

    this.global.alert.set({
      type: 'warning',
      title: 'Confirmación',
      message: `¿Deseas actualizar el aforo de ${tour.Nombre_Tour} a ${cupo} cupos para la fecha ${this.fecha}?`,
      buttons: [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.global.alert.set(null),
        },
        {
          text: 'Guardar',
          style: 'primary',
          onClick: () => {
            this.global.alert.set({
              title: 'Guardando aforo...',
              message: 'Por favor espera un momento.',
              loading: true,
              autoClose: false
            });

            this.inicioService.guardarCupo({
              SelectTour: tour.Id_Tour,
              NuevoCupo: Number(cupo),
              Fecha: this.fecha
            }).subscribe({
              next: (res) => {
                this.editando[tour.Id_Tour] = false;

                this.global.alert.set({
                  type: 'success',
                  title: '¡Listo!',
                  message: res.message || 'Aforo actualizado exitosamente.',
                  autoClose: true,
                  autoCloseTime: 3000,
                });

                // ✅ No es obligatorio recargar aquí; el WS lo actualizará.
                // Si quieres recargar para asegurar consistencia de pasajeros/privados:
                queueMicrotask(() => this.loadData());

                this.cdr.markForCheck();
              },
              error: (err) => {
                this.global.alert.set({
                  type: 'error',
                  title: 'Error',
                  message: err?.error?.error || 'No se pudo actualizar el aforo.',
                  autoClose: true,
                });
                this.cdr.markForCheck();
              }
            });
          },
        },
      ],
    });
  }
}
