// import { ChangeDetectorRef, Component, inject, NgZone, OnInit, ViewChild } from '@angular/core';
// import { ProgramacionService } from '../../../services/Programacion/programacion';
// import { Reservas } from '../../../services/Reservas/reservas';
// import { CommonModule } from '@angular/common';
// import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';
// import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
// import { Reserva, BusListado, Sugerencia } from '../../../interfaces/Programacion/reservas'; // ajusta si es necesario
// import { FormsModule } from '@angular/forms';

// // Si estás usando NgbModal, descomenta la siguiente línea:
// // import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

// @Component({
//   selector: 'app-listado',
//   imports: [CommonModule, DragDropModule, FormsModule], // Importa BusMapa aquí
//   templateUrl: './listado.html',
//   styleUrl: './listado.css'
// })
// export class Listado implements OnInit {
//   private global = inject(DynamicIslandGlobalService);
//   fechaSeleccionada: string = '';
//   tourSeleccionado: string = '';
//   tours: any[]; // Puedes cargar desde backend
//   error: string | null = null;
//   puntosSeleccionados: any[] | null = null;
//   puntosEnMapaConError: any[] | null = null; // Para almacenar los puntos no válidos del mapa
//   alert = this.global.alert;
//   mapa = this.global.puntos;
//   @ViewChild('modalRuta') modalRuta: any; // Referencia a la plantilla del modal
//   combinacionesSugeridas: Sugerencia[] = [];
//   combinacionSeleccionada: Sugerencia | null = null;


//   mostrarFormularioBuses = false;
//   modoManual = false;
//   editMode = false;
//   mostrarCombinaciones: boolean = false;
//   mostrarBotonVerOtras: boolean = false;


//   busesManual: any[] = [];


//   listado: any = {
//     fecha: '',
//     tour: '',
//     combinacionUsada: [],
//     buses: [],
//     sinAsignar: [],
//     totalPasajeros: 0
//   };

//   busesManuales: any[] = [];

//   constructor(
//     private service: ProgramacionService,
//     private zone: NgZone,
//     private cdr: ChangeDetectorRef,
//     private reservaService: Reservas
//     // Si usas NgbModal, inyéctalo aquí:
//     // private modalService: NgbModal
//   ) { }

//   ngOnInit(): void {
//     this.reservaService.getTours().subscribe({
//       next: res => {
//         this.tours = res;
//       }
//     })
//   }
//   cargarCombinaciones() {
//     this.error = '';
//     if (!this.fechaSeleccionada || !this.tourSeleccionado) {
//       this.error = 'Debes seleccionar una fecha y un tour.';
//       return;
//     }

//     this.listado = {
//       fecha: '',
//       tour: '',
//       combinacionUsada: [],
//       buses: [],
//       sinAsignar: [],
//       totalPasajeros: 0
//     };
//     this.global.alert.set({
//       title: 'Cargando...',
//       message: 'Cargando combinaciones sugeridas...',
//       loading: true
//     });
//     this.service.obtenerListado(this.fechaSeleccionada, Number(this.tourSeleccionado)).subscribe({
//       next: res => {
//         this.combinacionesSugeridas = res.sugerencias ?? [];
//         this.combinacionSeleccionada = null;
//         this.mostrarFormularioBuses = false;
//         this.modoManual = false;
//         this.mostrarCombinaciones = true;
//         this.mostrarBotonVerOtras = false;
//         this.cdr.markForCheck();
//         this.global.alert.set(null);
//       },
//       error: () => {
//         this.global.alert.set({
//           type: 'error',
//           title: 'Error',
//           message: 'No se pudieron cargar las combinaciones sugeridas.',
//           autoClose: true
//         })
//         this.cdr.markForCheck();
//       }
//     });
//   }



//   activarModoManual() {
//     this.modoManual = true;
//     this.mostrarCombinaciones = false;
//     this.mostrarFormularioBuses = false;
//     this.mostrarBotonVerOtras = true;
//     this.combinacionSeleccionada = null;
//     this.editMode = false;

//     // Limpiar listado actual
//     this.listado = {
//       fecha: '',
//       tour: '',
//       combinacionUsada: [],
//       buses: [],
//       sinAsignar: [],
//       totalPasajeros: 0
//     };

//     this.busesManual = [{ placa: '', capacidad: 0, guia: '' }];
//   }


//   agregarBusManual() {
//     this.busesManual.push({ placa: '', capacidad: 0, guia: '' });
//   }

//   seleccionarCombinacion(index: number) {
//     const seleccionada = this.combinacionesSugeridas[index];
//     this.combinacionSeleccionada = seleccionada;
//     this.mostrarFormularioBuses = true;
//     this.mostrarCombinaciones = false;
//     this.mostrarBotonVerOtras = true;
//     this.modoManual = false;

//     this.listado = {
//       fecha: this.fechaSeleccionada,
//       tour: this.tourSeleccionado,
//       totalPasajeros: seleccionada.buses.reduce((sum, bus) => sum + (bus.ocupados ?? 0), 0),
//       combinacionUsada: seleccionada.combinacion,
//       buses: seleccionada.buses.map((bus, i) => ({
//         ...bus,
//         id: i,
//         placa: '',
//         guia: '',
//         ocupados: bus.ocupados ?? bus.reservas.reduce((s, r) => s + r.NumeroPasajeros, 0)
//       })),
//       sinAsignar: seleccionada.sinAsignar ?? []
//     };

//     this.editMode = false;
//   }

//   trackByCombinacion(index: number, combinacion: Sugerencia): string {
//     return combinacion.combinacion.join('-');
//   }
//   enviarCombinacionManual() {
//     if (!this.fechaSeleccionada || !this.tourSeleccionado || !this.busesManual.length) {
//       this.error = 'Faltan datos para generar listados';
//       return;
//     }

//     const combinacion: any[] = this.busesManual.map((bus: any) => ({
//       placa: bus.placa,
//       capacidad: bus.capacidad,
//       guia: bus.guia
//     }));


//     this.service.generarListadoDesdeCombinacion(this.fechaSeleccionada, Number(this.tourSeleccionado), combinacion).subscribe({
//       next: (res: any) => {
//         this.listado = res;
//         this.editMode = false;
//         this.modoManual = false;
//         this.combinacionSeleccionada = null;
//         this.cdr.markForCheck();
//       },
//       error: () => {
//         this.error = 'Error al generar listados con la combinación manual';
//       }
//     });
//   }

//   verOtrasCombinaciones() {
//     this.combinacionSeleccionada = null;
//     this.mostrarFormularioBuses = false;
//     this.mostrarCombinaciones = true;
//     this.mostrarBotonVerOtras = false;
//     this.modoManual = false;
//     this.editMode = false;

//     // Limpiar listado si hay uno cargado
//     this.listado = {
//       fecha: '',
//       tour: '',
//       combinacionUsada: [],
//       buses: [],
//       sinAsignar: [],
//       totalPasajeros: 0
//     };
//   }

//   trackByBus(index: number, bus: any): number {
//     return index;
//   }

//   trackByReserva(index: number, reserva: any): string {
//     return reserva.Id_Reserva;
//   }

//   trackByReservaSinAsignar(index: number, item: any): string {
//     return item?.reserva?.Id_Reserva ?? index;
//   }

//   verMapa(bus: any): void {
//     this.global.puntos.set(bus.reservas);
//   }


//   /** Cambia entre lectura ↔ edición */
//   toggleEdit() { this.editMode = !this.editMode; }

//   /** Total ocupados en un bus */
//   ocupados(bus: BusListado): number {
//     return bus.reservas.reduce(
//       (s: number, r: Reserva) => s + r.NumeroPasajeros,
//       0
//     );
//   }


//   /** Drag&Drop: mover reserva entre buses o sin-asignar */
// dropReserva(ev: CdkDragDrop<any[]>, destino: number | 'sin') {
//   const reserva = ev.item.data;

//   const origenId = ev.previousContainer.id;
//   const destinoId = ev.container.id;

//   const origenEsSin = origenId === 'bus-sin';
//   const destinoEsSin = destinoId === 'bus-sin';

//   // 🔁 Si se reordenó dentro del mismo contenedor
//   if (ev.previousContainer === ev.container) {
//     const busIndex = destinoEsSin ? null : parseInt(destinoId.replace('bus-', ''));
//     if (destinoEsSin) {
//       moveItemInArray(this.listado.sinAsignar, ev.previousIndex, ev.currentIndex);
//     } else if (!isNaN(busIndex)) {
//       moveItemInArray(this.listado.buses[busIndex].reservas, ev.previousIndex, ev.currentIndex);
//     }
//     this.cdr.markForCheck();
//     return;
//   }

//   // 🔄 Caso normal: mover entre buses o desde sin asignar
//   if (origenEsSin) {
//     this.listado.sinAsignar = this.listado.sinAsignar.filter((r: { Id_Reserva: any; }) => r.Id_Reserva !== reserva.Id_Reserva);
//   } else {
//     const origenIndex = parseInt(origenId.replace('bus-', ''));
//     this.listado.buses[origenIndex].reservas = this.listado.buses[origenIndex].reservas.filter((r: { Id_Reserva: any; }) => r.Id_Reserva !== reserva.Id_Reserva);
//     this.listado.buses[origenIndex].ocupados = this.ocupados(this.listado.buses[origenIndex]);
//   }

//   if (destinoEsSin) {
//     this.listado.sinAsignar.push(reserva);
//   } else {
//     const destinoIndex = parseInt(destinoId.replace('bus-', ''));
//     const bus = this.listado.buses[destinoIndex];
//     const nuevosOcupados = this.ocupados(bus) + reserva.NumeroPasajeros;

//     if (bus.capacidad && nuevosOcupados > bus.capacidad) {
//       this.global.alert.set({
//         type: 'warning',
//         title: 'Capacidad excedida',
//         message: `Este bus no tiene espacio para ${reserva.NumeroPasajeros} pasajeros adicionales.`,
//         autoClose: true
//       });
//       return;
//     }

//     bus.reservas.splice(ev.currentIndex, 0, reserva); // Inserta en posición exacta
//     bus.ocupados = this.ocupados(bus);
//   }

//   this.cdr.markForCheck();
// }

//   get busIds(): string[] {
//     return ['bus-sin', ...this.listado.buses.map((bus: BusListado, i: number) => `bus-${i}`)];
//   }

//   guardarCambios(): void {
//     if (this.combinacionSeleccionada && this.combinacionSeleccionada.buses?.length) {
//       this.combinacionSeleccionada.buses.forEach((busForm, i) => {
//         if (this.listado.buses[i]) {
//           this.listado.buses[i].placa = busForm.placa;
//           this.listado.buses[i].guia = busForm.guia;
//         }
//       });
//     }
//     this.editMode = false;
//     this.mostrarFormularioBuses = false;
//     this.mostrarCombinaciones = false;
//     this.mostrarBotonVerOtras = false;
//     this.combinacionSeleccionada = null;

//   }

// }