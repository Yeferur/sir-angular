import { Routes } from '@angular/router';
import { Inicio } from './pages/Inicio/inicio';
import { Historial } from './services/Historial/historial.service';
import { CrearTourComponent } from './pages/Tours/crear-tour/crear-tour';
import { EditarTourComponent } from './pages/Tours/editar-tour/editar-tour';
import { VerToursComponent } from './pages/Tours/ver-tours/ver-tours';
import { PreciosTourComponent } from './pages/Tours/precios/precios';
import { CrearReservaComponent } from './pages/Reservas/crear-reserva/crear-reserva';
import { EditarReservaComponent } from './pages/Reservas/editar-reserva/editar-reserva';
import { VerReservasComponent } from './pages/Reservas/ver-reservas/ver-reservas';
// import { MapaPuntos } from './pages/Puntos/mapa-puntos/mapa-puntos';
import { VerPuntos } from './pages/Puntos/ver-puntos/ver-puntos';
import { CrearPuntoComponent } from './pages/Puntos/crear-punto/crear-punto';
import { EditarPuntoComponent } from './pages/Puntos/editar-punto/editar-punto';
import { Listado } from './pages/Programacion/listado/listado';
import { Usuarios } from './pages/Usuarios/usuarios/usuarios';
import { CrearTransferComponent } from './pages/Transfers/crear-transfer/crear-transfer';
import { VerTransfersComponent } from './pages/Transfers/ver-transfers/ver-transfers';
import { VerHistorialComponent } from './pages/Historial/ver-historial/ver-historial';


export const routes: Routes = [
    { path: '', component: Inicio },
    { path: 'Historial', component: VerHistorialComponent },
    { path: 'Reservas/NuevaReserva', component: CrearReservaComponent },
    { path: 'Reservas/VerReservas', component: VerReservasComponent },
    { path: 'Reservas/EditarReserva/:id', component: EditarReservaComponent },
    { path: 'Transfers/NuevoTransfer', component: CrearTransferComponent },
    { path: 'Transfers/VerTransfers', component: VerTransfersComponent },
    // { path: 'Puntos/MapaPuntos', component: MapaPuntos },
    { path: 'Puntos/VerPuntos', component: VerPuntos },
    { path: 'Puntos/NuevoPunto', component: CrearPuntoComponent },
    { path: 'Puntos/Editar/:id', component: EditarPuntoComponent },
    { path: 'Programacion/Listado', component: Listado },
    { path: 'Usuarios', component: Usuarios },
    { path: 'Tours/NuevoTour', component: CrearTourComponent },
    { path: 'Tours/VerTours', component: VerToursComponent },
    { path: 'Tours/Editar/:id', component: EditarTourComponent },
    { path: 'Tours/Precios/:id', component: PreciosTourComponent },
    { path: 'Historial', component: VerHistorialComponent },
];
