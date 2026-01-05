import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject, effect } from '@angular/core';
import { WebSocketService } from '../../services/WebSocket/web-socket';
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
  private wsService = inject(WebSocketService);

  editando: { [key: number]: boolean } = {};
  nuevoCupo: { [key: number]: string } = {};
  mostrarDetallesCombinada = false;
  isLoading = false;

  mostrarAlerta() {
    this.global.alert.set({
      title: 'Guardando aforo...',
      message: 'Por favor espera un momento.',
      loading: true, // Activa el modo loading
      autoClose: false // No se autocierra mientras carga
    });

    // Esperar 3 segundos antes de cambiar el estado de alerta
    setTimeout(() => {
      this.global.alert.set({
        type: 'success',
        title: '¡Listo!',
        message: 'Se ha creado el nuevo aforo.',
        autoClose: true,
        autoCloseTime: 3000,
      });
    }, 3000); // ← aquí estaba el error
  }



  mostrarAlertaConBoton() {
    this.global.alert.set({
      type: 'warning',
      title: 'Confirmación',
      message: '¿Estás seguro que deseas continuar?',
      buttons: [
        {
          text: 'Aceptar',
          style: 'primary',
          onClick: () => {
            this.global.alert.set(null);
            // Aquí puedes ejecutar otra acción
          },
        },
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.global.alert.set(null),
        },
      ],
    });
  }
  constructor() { }
  fecha: string = new Date().toISOString().split('T')[0];

  tours: Tour[] = [];
  transfers: Transfer[] = [];

  combinedTour: Tour | null = null;
  combinedDetails: Tour[] = [];

  ngOnInit(): void {
    this.loadData();
    
    // Reaccionar a actualizaciones de aforos en tiempo real
    effect(() => {
      const aforo = this.inicioService.aforoActualizado();
      if (aforo) {
        console.log('🔄 Reloading data debido a cambio de aforo:', aforo);
        this.loadData();
      }
    });
    
    // Reaccionar a actualizaciones de reservas en tiempo real
    effect(() => {
      const reserva = this.inicioService.reservaActualizada();
      if (reserva && reserva.Fecha_Tour === this.fecha) {
        console.log('🔄 Reloading data debido a cambio de reserva:', reserva);
        this.loadData();
      }
    });
  }

  onFechaChange(event: Event) {
    this.fecha = (event.target as HTMLInputElement).value;
    this.loadData();
  }

  loadData() {
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
            NumeroPasajeros:
              (tour1.NumeroPasajeros || 0) + (tour5.NumeroPasajeros || 0),
            cupos: +tour5.cupos || 0,
            totalPrivados:
              (tour1.totalPrivados || 0) + (tour5.totalPrivados || 0),
            privados: [],
          };
          this.combinedDetails = [tour1, tour5];
        }
        this.cdr.detectChanges();
      },
    });
  }

  getCardColor(pasajeros: number, cupos: number): string {
    const usage = (pasajeros / cupos) * 100;
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
    this.editando[5] = false; // Si abre detalles, cancela edición
  }


  activarEdicion(id: number) {
    this.editando[id] = true;

    const tour =
      id === 5 && this.combinedTour
        ? this.combinedTour
        : this.tours.find((t) => t.Id_Tour === id);

    this.nuevoCupo[id] = tour?.cupos?.toString() || '';
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
                this.loadData();
              },
              error: (err) => {
                this.global.alert.set({
                  type: 'error',
                  title: 'Error',
                  message: err?.error?.error || 'No se pudo actualizar el aforo. El cupo no puede ser menor al número de pasajeros existentes.',
                  autoClose: true,
                });
              }
            });
          },
        },
      ],
    });
  }

  // enviarAforo(Id_Tour: number, NuevoCupo: number) {
  //   this.global.alert.set(null);
  //   this.global.alert.set({ loading: true, title: 'Actualizando...', message: 'Espere un momento.' });

  //   const body = {
  //     SelectTour: Id_Tour,
  //     NuevoCupo,
  //     Fecha: this.fecha,
  //     id_user: 1, // reemplaza con el id real si es necesario
  //   };

  //   this.inicioService.guardarCupo(body).subscribe({
  //     next: (res) => {
  //       this.editando[Id_Tour] = false;
  //       this.global.alert.set({
  //         type: 'success',
  //         title: 'Actualizado',
  //         message: res.message || 'Aforo actualizado exitosamente.',
  //         autoClose: true,
  //       });
  //       this.loadData(); // refrescar
  //     },
  //     error: (err) => {
  //       this.global.alert.set({
  //         type: 'error',
  //         title: 'Error',
  //         message: err.message || 'No se pudo actualizar el aforo.',
  //         autoClose: true,
  //       });
  //     },
  //   });
  // }

}
