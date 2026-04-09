import { Routes } from '@angular/router';
import { unsavedChangesGuard } from './guards/unsaved-changes.guard';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/Inicio/inicio').then((m) => m.Inicio),
    title: 'SIR · Inicio',
  },
  {
    path: 'Dashboard',
    loadComponent: () => import('./pages/Dashboard/dashboard').then((m) => m.DashboardComponent),
    title: 'SIR · Dashboard',
  },
  {
    path: 'Historial',
    loadComponent: () => import('./pages/Historial/ver-historial/ver-historial').then((m) => m.VerHistorialComponent),
    title: 'SIR · Historial',
  },

  {
    path: 'Reservas/NuevaReserva',
    loadComponent: () => import('./pages/Reservas/crear-reserva/crear-reserva').then((m) => m.CrearReservaComponent),
    canDeactivate: [unsavedChangesGuard],
    title: 'SIR · Nueva Reserva',
  },
  {
    path: 'Reservas/VerReservas',
    loadComponent: () => import('./pages/Reservas/ver-reservas/ver-reservas').then((m) => m.VerReservasComponent),
    title: 'SIR · Ver Reservas',
  },
  {
    path: 'Reservas/EditarReserva/:id',
    loadComponent: () => import('./pages/Reservas/editar-reserva/editar-reserva').then((m) => m.EditarReservaComponent),
    canDeactivate: [unsavedChangesGuard],
    title: 'SIR · Editar Reserva',
  },

  {
    path: 'Transfers/NuevoTransfer',
    loadComponent: () => import('./pages/Transfers/crear-transfer/crear-transfer').then((m) => m.CrearTransferComponent),
    canDeactivate: [unsavedChangesGuard],
    title: 'SIR · Nuevo Transfer',
  },
  {
    path: 'Transfers/VerTransfers',
    loadComponent: () => import('./pages/Transfers/ver-transfers/ver-transfers').then((m) => m.VerTransfersComponent),
    title: 'SIR · Ver Transfers',
  },

  {
    path: 'Puntos/VerPuntos',
    loadComponent: () => import('./pages/Puntos/ver-puntos/ver-puntos').then((m) => m.VerPuntos),
    title: 'SIR · Ver Puntos',
  },
  {
    path: 'Puntos/NuevoPunto',
    loadComponent: () => import('./pages/Puntos/crear-punto/crear-punto').then((m) => m.CrearPuntoComponent),
    canDeactivate: [unsavedChangesGuard],
    title: 'SIR · Nuevo Punto',
  },
  {
    path: 'Puntos/Editar/:id',
    loadComponent: () => import('./pages/Puntos/editar-punto/editar-punto').then((m) => m.EditarPuntoComponent),
    canDeactivate: [unsavedChangesGuard],
    title: 'SIR · Editar Punto',
  },
  {
    path: 'Puntos/OrdenarPuntos',
    loadComponent: () => import('./pages/Puntos/ordenar-puntos/ordenar-puntos').then((m) => m.OrdenarPuntosComponent),
    title: 'SIR · Ordenar Puntos',
  },

  {
    path: 'Programacion/Listado',
    loadComponent: () => import('./pages/Programacion/listado/listado').then((m) => m.Listado),
    title: 'SIR · Programación',
  },

  {
    path: 'Reservas/Confirmacion',
    loadComponent: () => import('./pages/Confirmacion/confirmacion/confirmacion').then((m) => m.ConfirmacionComponent),
    canDeactivate: [unsavedChangesGuard],
    title: 'SIR · Confirmación de Viaje',
  },
  {
    path: 'Comisiones',
    loadComponent: () => import('./pages/Comisiones/comisiones/comisiones').then((m) => m.ComisionesComponent),
    title: 'SIR · Comisiones',
  },
  {
    path: 'Seguros',
    loadComponent: () => import('./pages/Seguros/seguros/seguros').then((m) => m.SegurosComponent),
    title: 'SIR · Seguros',
  },

  {
    path: 'Usuarios',
    loadComponent: () => import('./pages/Usuarios/usuarios/usuarios').then((m) => m.Usuarios),
    title: 'SIR · Usuarios',
  },
  {
    path: 'Usuarios/NuevoUsuario',
    loadComponent: () => import('./pages/Usuarios/crear-usuario/crear-usuario').then((m) => m.CrearUsuarioComponent),
    canDeactivate: [unsavedChangesGuard],
    title: 'SIR · Nuevo Usuario',
  },
  {
    path: 'Usuarios/Editar/:id',
    loadComponent: () => import('./pages/Usuarios/editar-usuario/editar-usuario').then((m) => m.EditarUsuarioComponent),
    canDeactivate: [unsavedChangesGuard],
    title: 'SIR · Editar Usuario',
  },
  {
    path: 'Perfil/Editar',
    loadComponent: () => import('./pages/Perfil/editar-perfil/editar-perfil').then((m) => m.EditarPerfilComponent),
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    title: 'SIR · Editar Perfil',
  },

  {
    path: 'Tours/NuevoTour',
    loadComponent: () => import('./pages/Tours/crear-tour/crear-tour').then((m) => m.CrearTourComponent),
    canDeactivate: [unsavedChangesGuard],
    title: 'SIR · Nuevo Tour',
  },
  {
    path: 'Tours/VerTours',
    loadComponent: () => import('./pages/Tours/ver-tours/ver-tours').then((m) => m.VerToursComponent),
    title: 'SIR · Ver Tours',
  },
  {
    path: 'Tours/Editar/:id',
    loadComponent: () => import('./pages/Tours/editar-tour/editar-tour').then((m) => m.EditarTourComponent),
    canDeactivate: [unsavedChangesGuard],
    title: 'SIR · Editar Tour',
  },
  {
    path: 'Tours/Precios/:id',
    loadComponent: () => import('./pages/Tours/precios/precios').then((m) => m.PreciosTourComponent),
    canDeactivate: [unsavedChangesGuard],
    title: 'SIR · Precios del Tour',
  },

  { path: '**', redirectTo: '' },
];
