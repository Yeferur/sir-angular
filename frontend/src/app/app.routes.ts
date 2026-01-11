import { Routes } from '@angular/router';
import { Inicio } from './pages/Inicio/inicio';
import { CrearTourComponent } from './pages/Tours/crear-tour/crear-tour';
import { EditarTourComponent } from './pages/Tours/editar-tour/editar-tour';
import { VerToursComponent } from './pages/Tours/ver-tours/ver-tours';
import { PreciosTourComponent } from './pages/Tours/precios/precios';
import { CrearReservaComponent } from './pages/Reservas/crear-reserva/crear-reserva';
import { EditarReservaComponent } from './pages/Reservas/editar-reserva/editar-reserva';
import { VerReservasComponent } from './pages/Reservas/ver-reservas/ver-reservas';
import { VerPuntos } from './pages/Puntos/ver-puntos/ver-puntos';
import { CrearPuntoComponent } from './pages/Puntos/crear-punto/crear-punto';
import { EditarPuntoComponent } from './pages/Puntos/editar-punto/editar-punto';
import { Listado } from './pages/Programacion/listado/listado';
import { Usuarios } from './pages/Usuarios/usuarios/usuarios';
import { CrearTransferComponent } from './pages/Transfers/crear-transfer/crear-transfer';
import { VerTransfersComponent } from './pages/Transfers/ver-transfers/ver-transfers';
import { VerHistorialComponent } from './pages/Historial/ver-historial/ver-historial';
import { CrearUsuarioComponent } from './pages/Usuarios/crear-usuario/crear-usuario';

export const routes: Routes = [
  { path: '', component: Inicio, title: 'SIR · Inicio' },

  { path: 'Historial', component: VerHistorialComponent, title: 'SIR · Historial' },

  { path: 'Reservas/NuevaReserva', component: CrearReservaComponent, title: 'SIR · Nueva Reserva' },
  { path: 'Reservas/VerReservas', component: VerReservasComponent, title: 'SIR · Ver Reservas' },
  { path: 'Reservas/EditarReserva/:id', component: EditarReservaComponent, title: 'SIR · Editar Reserva' },

  { path: 'Transfers/NuevoTransfer', component: CrearTransferComponent, title: 'SIR · Nuevo Transfer' },
  { path: 'Transfers/VerTransfers', component: VerTransfersComponent, title: 'SIR · Ver Transfers' },

  { path: 'Puntos/VerPuntos', component: VerPuntos, title: 'SIR · Ver Puntos' },
  { path: 'Puntos/NuevoPunto', component: CrearPuntoComponent, title: 'SIR · Nuevo Punto' },
  { path: 'Puntos/Editar/:id', component: EditarPuntoComponent, title: 'SIR · Editar Punto' },

  { path: 'Programacion/Listado', component: Listado, title: 'SIR · Programación' },

  { path: 'Usuarios', component: Usuarios, title: 'SIR · Usuarios' },
  { path: 'Usuarios/NuevoUsuario', component: CrearUsuarioComponent, title: 'SIR · Nuevo Usuario' },

  { path: 'Tours/NuevoTour', component: CrearTourComponent, title: 'SIR · Nuevo Tour' },
  { path: 'Tours/VerTours', component: VerToursComponent, title: 'SIR · Ver Tours' },
  { path: 'Tours/Editar/:id', component: EditarTourComponent, title: 'SIR · Editar Tour' },
  { path: 'Tours/Precios/:id', component: PreciosTourComponent, title: 'SIR · Precios del Tour' },

  // opcional: 404
  { path: '**', redirectTo: '' }
];
