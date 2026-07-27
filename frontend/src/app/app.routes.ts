import { Routes } from '@angular/router';
import { unsavedChangesGuard } from './guards/unsaved-changes.guard';
import { authGuard } from './guards/auth.guard';
import { permisoGuard } from './guards/permission.guard';
import { LoginContentComponent } from './components/login/login';
import { EditarTourComponent } from './pages/Tours/editar-tour/editar-tour';

export const routes: Routes = [
  {
    path: 'reset-password',
    component: LoginContentComponent,
    title: 'Restablecer contraseña',
  },
  {
    path: '',
    loadComponent: () => import('./pages/Inicio/inicio').then((m) => m.Inicio),
    canActivate: [authGuard],
    data: { preload: true },
    title: 'Aforos',
  },
  {
    path: 'Dashboard',
    loadComponent: () => import('./pages/Dashboard/dashboard').then((m) => m.DashboardComponent),
    canActivate: [authGuard],
    title: 'Dashboard',
  },
  {
    path: 'Historial',
    loadComponent: () => import('./pages/Historial/ver-historial').then((m) => m.VerHistorialComponent),
    canActivate: [authGuard],
    title: 'Historial',
  },

  {
    path: 'Reservas/NuevaReserva',
    loadComponent: () => import('./pages/Reservas/crear-reserva/crear-reserva').then((m) => m.CrearReservaComponent),
    canActivate: [authGuard, permisoGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { preload: true, permiso: 'RESERVAS.CREAR', redirectTo: '/Reservas/VerReservas' },
    title: 'Nueva Reserva',
  },
  {
    path: 'Reservas/VerReservas',
    loadComponent: () => import('./pages/Reservas/ver-reservas/ver-reservas').then((m) => m.VerReservasComponent),
    canActivate: [authGuard],
    data: { preload: true },
    title: 'Ver Reservas',
  },
  {
    path: 'Reservas/EditarReserva/:id',
    loadComponent: () => import('./pages/Reservas/editar-reserva/editar-reserva').then((m) => m.EditarReservaComponent),
    canActivate: [authGuard, permisoGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { preload: true, permiso: 'RESERVAS.ACTUALIZAR', redirectTo: '/Reservas/VerReservas' },
    title: 'Editar Reserva',
  },

  {
    path: 'Transfers/NuevoTransfer',
    loadComponent: () => import('./pages/Transfers/crear-transfer/crear-transfer').then((m) => m.CrearTransferComponent),
    canActivate: [authGuard, permisoGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { preload: true, permiso: 'TRANSFERS.CREAR', redirectTo: '/Transfers/VerTransfers' },
    title: 'Nuevo Transfer',
  },
  {
    path: 'Transfers/EditarTransfer/:id',
    loadComponent: () => import('./pages/Transfers/editar-transfer/editar-transfer').then((m) => m.EditarTransferComponent),
    canActivate: [authGuard, permisoGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { preload: true, permiso: 'TRANSFERS.ACTUALIZAR', redirectTo: '/Transfers/VerTransfers' },
    title: 'Editar Transfer',
  },
  {
    path: 'Transfers/VerTransfers',
    loadComponent: () => import('./pages/Transfers/ver-transfers/ver-transfers').then((m) => m.VerTransfersComponent),
    canActivate: [authGuard],
    data: { preload: true },
    title: 'Ver Transfers',
  },

  {
    path: 'Puntos/VerPuntos',
    loadComponent: () => import('./pages/Puntos/ver-puntos/ver-puntos').then((m) => m.VerPuntos),
    canActivate: [authGuard],
    title: 'Puntos de Encuentro',
  },
  {
    path: 'Puntos/NuevoPunto',
    loadComponent: () => import('./pages/Puntos/crear-punto/crear-punto').then((m) => m.CrearPuntoComponent),
    canActivate: [authGuard, permisoGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { permiso: 'PUNTOS.CREAR', redirectTo: '/Puntos/VerPuntos' },
    title: 'Nuevo Punto',
  },
  {
    path: 'Puntos/Editar/:id',
    loadComponent: () => import('./pages/Puntos/editar-punto/editar-punto').then((m) => m.EditarPuntoComponent),
    canActivate: [authGuard, permisoGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { permiso: 'PUNTOS.ACTUALIZAR', redirectTo: '/Puntos/VerPuntos' },
    title: 'Editar Punto',
  },
  {
    path: 'Puntos/OrdenarPuntos',
    loadComponent: () => import('./pages/Puntos/ordenar-puntos/ordenar-puntos').then((m) => m.OrdenarPuntosComponent),
    canActivate: [authGuard, permisoGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { permiso: 'PUNTOS.ORDENAR', redirectTo: '/Puntos/VerPuntos' },
    title: 'Ordenar Puntos',
  },

  {
    path: 'Programacion/Listado',
    loadComponent: () => import('./pages/Programacion/listado/listado').then((m) => m.Listado),
    canActivate: [authGuard],
    data: { preload: true },
    title: 'Programación',
  },

  {
    path: 'Reservas/Confirmacion',
    loadComponent: () => import('./pages/Confirmacion/confirmacion').then((m) => m.ConfirmacionComponent),
    canActivate: [authGuard, permisoGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { permiso: 'CONTROL_VIAJE.LEER', redirectTo: '/Reservas/VerReservas' },
    title: 'Control de Viaje',
  },
  {
    path: 'Comisiones',
    loadComponent: () => import('./pages/Comisiones/comisiones').then((m) => m.ComisionesComponent),
    canActivate: [authGuard],
    title: 'Comisiones',
  },
  {
    path: 'Seguros',
    loadComponent: () => import('./pages/Seguros/seguros').then((m) => m.SegurosComponent),
    canActivate: [authGuard],
    title: 'Seguros',
  },

  {
    path: 'Usuarios',
    loadComponent: () => import('./pages/Usuarios/usuarios/usuarios').then((m) => m.Usuarios),
    canActivate: [authGuard],
    title: 'Usuarios',
  },
  {
    path: 'Usuarios/NuevoUsuario',
    loadComponent: () => import('./pages/Usuarios/crear-usuario/crear-usuario').then((m) => m.CrearUsuarioComponent),
    canActivate: [authGuard, permisoGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { permiso: 'USUARIOS.CREAR', redirectTo: '/Usuarios' },
    title: 'Nuevo Usuario',
  },
  {
    path: 'Usuarios/Editar/:id',
    loadComponent: () => import('./pages/Usuarios/editar-usuario/editar-usuario').then((m) => m.EditarUsuarioComponent),
    canActivate: [authGuard, permisoGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { permiso: 'USUARIOS.ACTUALIZAR', redirectTo: '/Usuarios' },
    title: 'Editar Usuario',
  },
  {
    path: 'Perfil/Editar',
    loadComponent: () => import('./pages/Perfil/editar-perfil/editar-perfil').then((m) => m.EditarPerfilComponent),
    canActivate: [authGuard],
    canDeactivate: [unsavedChangesGuard],
    title: 'Editar Perfil',
  },
  {
    path: 'Ayuda',
    loadComponent: () => import('./pages/ayuda/ayuda').then((m) => m.AyudaComponent),
    canActivate: [authGuard],
    title: 'Ayuda',
  },

  {
    path: 'Tours/NuevoTour',
    loadComponent: () => import('./pages/Tours/crear-tour/crear-tour').then((m) => m.CrearTourComponent),
    canActivate: [authGuard, permisoGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { preload: true, permiso: 'TOURS.CREAR', redirectTo: '/Tours/VerTours' },
    title: 'Nuevo Tour',
  },
  {
    path: 'Tours/VerTours',
    loadComponent: () => import('./pages/Tours/ver-tours/ver-tours').then((m) => m.VerToursComponent),
    canActivate: [authGuard],
    data: { preload: true },
    title: 'Ver Tours',
  },
  {
    path: 'Tours/Editar/:id',
    component: EditarTourComponent,
    canActivate: [authGuard, permisoGuard],
    canDeactivate: [unsavedChangesGuard],
    data: { preload: true, permiso: 'TOURS.ACTUALIZAR', redirectTo: '/Tours/VerTours' },
    title: 'Editar Tour',
  },
  

  { path: '**', redirectTo: '' },
];
