/* ====================================================================
   EJEMPLOS DE USO DEL SISTEMA RBAC
   ==================================================================== */

// =====================================================
// 1. PROTEGER NUEVAS RUTAS EN EL BACKEND
// =====================================================

// Ejemplo: Nueva ruta para descargar reportes
// backend/routes/Reportes/reportes.routes.js

const express = require('express');
const router = express.Router();
const reportesController = require('../../controllers/Reportes/reportes.controller');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { checkPermission, checkAnyPermission } = require('../../middlewares/permissionsMiddleware');

// Solo usuarios con permiso REPORTES.LEER
router.get('/reportes', 
  authMiddleware, 
  checkPermission('REPORTES.LEER'), 
  reportesController.getReportes
);

// Solo usuarios que puedan descargar (REPORTES.DESCARGAR O USUARIOS.GESTIONAR_ROLES)
router.post('/reportes/descargar', 
  authMiddleware, 
  checkAnyPermission(['REPORTES.DESCARGAR', 'USUARIOS.GESTIONAR_ROLES']), 
  reportesController.descargarReporte
);

// Solo administradores
router.delete('/reportes/:id', 
  authMiddleware, 
  requireAdmin(), 
  reportesController.eliminarReporte
);

module.exports = router;

---

// =====================================================
// 2. USAR PERMISOS EN COMPONENTES ANGULAR
// =====================================================

// frontend/src/app/pages/Tours/tours-list/tours-list.component.ts

import { Component, OnInit } from '@angular/core';
import { PermisosService } from '../../../services/Permisos/permisos.service';
import { ToursService } from '../../../services/Tours/tours.service';

@Component({
  selector: 'app-tours-list',
  template: `
    <div class="container">
      <h1>Listado de Tours</h1>

      <!-- Botón crear (solo si tiene permiso) -->
      <button 
        class="btn btn-primary mb-3"
        *appPermiso="'TOURS.CREAR'"
        (click)="irACrear()"
      >
        <i class="bi bi-plus"></i> Crear Tour
      </button>

      <!-- Tabla de tours -->
      <table class="table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Destino</th>
            <th *appPermiso="'TOURS.ACTUALIZAR'">Editar</th>
            <th *appPermiso="'TOURS.ELIMINAR'">Eliminar</th>
            <th *appPermiso="'TOURS.DESCARGAR'">Descargar</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let tour of tours">
            <td>{{ tour.nombre }}</td>
            <td>{{ tour.destino }}</td>
            <td *appPermiso="'TOURS.ACTUALIZAR'">
              <button (click)="editar(tour)" class="btn btn-sm btn-warning">
                Editar
              </button>
            </td>
            <td *appPermiso="'TOURS.ELIMINAR'">
              <button (click)="eliminar(tour)" class="btn btn-sm btn-danger">
                Eliminar
              </button>
            </td>
            <td *appPermiso="'TOURS.DESCARGAR'">
              <button (click)="descargar(tour)" class="btn btn-sm btn-success">
                PDF
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `
})
export class ToursListComponent implements OnInit {
  tours = [];

  constructor(
    private permisosService: PermisosService,
    private toursService: ToursService
  ) {}

  ngOnInit() {
    this.cargarTours();
  }

  cargarTours() {
    this.toursService.getTours().subscribe(tours => {
      this.tours = tours;
    });
  }

  irACrear() {
    // Navegación solo disponible si el usuario tiene permiso
    if (!this.permisosService.tienePermiso('TOURS.CREAR')) {
      alert('No tiene permisos para crear tours');
      return;
    }
    // Navegar a crear...
  }

  editar(tour: any) {
    if (!this.permisosService.tienePermiso('TOURS.ACTUALIZAR')) {
      alert('No tiene permisos para editar tours');
      return;
    }
    // Editar...
  }

  eliminar(tour: any) {
    if (!this.permisosService.tienePermiso('TOURS.ELIMINAR')) {
      alert('No tiene permisos para eliminar tours');
      return;
    }
    // Eliminar...
  }

  descargar(tour: any) {
    if (!this.permisosService.tienePermiso('TOURS.DESCARGAR')) {
      alert('No tiene permisos para descargar');
      return;
    }
    // Descargar...
  }
}

---

// =====================================================
// 3. AGREGAR NUEVO PERMISO EN LA BASE DE DATOS
// =====================================================

// SQL para agregar permiso TOURS.EXPORTAR

INSERT INTO `modulos` 
  (Nombre_Modulo, Codigo_Modulo, Icono, Ruta, Orden) 
VALUES 
  ('Exportar Tours', 'TOURS_EXPORT', 'download', null, 3);

INSERT INTO `permisos` 
  (Id_Modulo, Accion, Codigo_Permiso, Descripcion) 
VALUES 
  (
    (SELECT Id_Modulo FROM modulos WHERE Codigo_Modulo = 'TOURS'),
    'EXPORTAR',
    'TOURS.EXPORTAR',
    'Exportar datos de tours a Excel/CSV'
  );

-- Asignar a Administrador
INSERT INTO `rol_permisos` (Id_Rol, Id_Permiso)
SELECT 1, Id_Permiso FROM permisos WHERE Codigo_Permiso = 'TOURS.EXPORTAR';

-- Invalidar cache
POST /api/cache/invalidar { userId: null }

---

// =====================================================
// 4. CREAR COMPONENTE CON ACCESO CONDICIONAL AVANZADO
// =====================================================

// frontend/src/app/pages/Dashboard/dashboard.component.ts

import { Component, OnInit } from '@angular/core';
import { PermisosService } from '../../../services/Permisos/permisos.service';

interface Tarjeta {
  titulo: string;
  icono: string;
  permisos: string[];
  requireAll: boolean;
}

@Component({
  selector: 'app-dashboard',
  template: `
    <div class="dashboard">
      <h1>Dashboard</h1>

      <!-- Mostrar solo si tiene ALGUNO de estos permisos -->
      <div *appPermiso="['TOURS.LEER', 'RESERVAS.LEER']" class="row">
        <div *ngFor="let tarjeta of tarjetas" class="col-md-4 mb-3">
          <div class="card" *appPermiso="tarjeta.permisos; requireAll: tarjeta.requireAll">
            <div class="card-body">
              <h5 class="card-title">
                <i [class]="'bi bi-' + tarjeta.icono"></i>
                {{ tarjeta.titulo }}
              </h5>
              <p class="card-text">Contenido protegido por permisos</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Mostrar solo si es admin -->
      <div *appPermiso="'USUARIOS.GESTIONAR_ROLES'" class="mt-4 p-3 bg-light rounded">
        <h4>Panel de Administración</h4>
        <p>Opciones avanzadas solo para administradores</p>
      </div>
    </div>
  `
})
export class DashboardComponent implements OnInit {
  tarjetas: Tarjeta[] = [];

  constructor(private permisosService: PermisosService) {}

  ngOnInit() {
    // Construir tarjetas dinámicamente
    this.tarjetas = [
      {
        titulo: 'Tours',
        icono: 'map',
        permisos: ['TOURS.LEER'],
        requireAll: false
      },
      {
        titulo: 'Reservas',
        icono: 'calendar',
        permisos: ['RESERVAS.CREAR', 'RESERVAS.ACTUALIZAR'],
        requireAll: false  // Mostrar si tiene al menos uno
      },
      {
        titulo: 'Operaciones',
        icono: 'gear',
        permisos: ['PROGRAMACION.ACTUALIZAR', 'PUNTOS.ACTUALIZAR'],
        requireAll: true   // Mostrar solo si tiene TODOS
      }
    ];
  }
}

---

// =====================================================
// 5. USAR PERMISOS EN GUARDS DE RUTAS
// =====================================================

// frontend/src/app/guards/permission.guard.ts

import { Injectable } from '@angular/core';
import { CanActivate, Router, ActivatedRouteSnapshot } from '@angular/router';
import { PermisosService } from '../services/Permisos/permisos.service';

@Injectable({
  providedIn: 'root'
})
export class PermissionGuard implements CanActivate {
  constructor(
    private permisosService: PermisosService,
    private router: Router
  ) {}

  canActivate(route: ActivatedRouteSnapshot): boolean {
    // Leer permiso requerido de los datos de la ruta
    const requiredPermission = route.data['permission'];

    if (!requiredPermission) {
      return true; // Sin requisito de permiso
    }

    const tienePermiso = this.permisosService.tienePermiso(requiredPermission);

    if (!tienePermiso) {
      console.warn(`Acceso denegado: permiso requerido ${requiredPermission}`);
      this.router.navigate(['/acceso-denegado']);
      return false;
    }

    return true;
  }
}

// Usar en rutas:
const routes = [
  {
    path: 'administracion/permisos',
    component: PermissionsAdminComponent,
    canActivate: [PermissionGuard],
    data: { permission: 'USUARIOS.GESTIONAR_ROLES' }
  },
  {
    path: 'tours/crear',
    component: CrearTourComponent,
    canActivate: [PermissionGuard],
    data: { permission: 'TOURS.CREAR' }
  }
];

---

// =====================================================
// 6. INTEGRAR EN INTERCEPTOR HTTP
// =====================================================

// frontend/src/app/interceptors/auth.interceptor.ts (existente)
// Se puede extender para rechazar requests sin permisos

import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PermisosService } from '../services/Permisos/permisos.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private permisosService: PermisosService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Verificar si la ruta requiere un permiso específico
    // Basado en URL o headers personalizados
    const requiredPermission = this.extractPermissionFromRequest(req);

    if (requiredPermission && !this.permisosService.tienePermiso(requiredPermission)) {
      // Rechazar la solicitud en el cliente antes de enviar
      console.warn(`Solicitud rechazada: permiso requerido ${requiredPermission}`);
      // Opcionalmente: throw error o redirigir
    }

    return next.handle(req);
  }

  private extractPermissionFromRequest(req: HttpRequest<any>): string | null {
    // Lógica para extraer permiso requerido del request
    // Ejemplo: del header X-Required-Permission
    return req.headers.get('X-Required-Permission');
  }
}

---

// =====================================================
// 7. CREAR CUSTOM PIPE PARA PERMISOS
// =====================================================

// frontend/src/app/pipes/has-permission.pipe.ts

import { Pipe, PipeTransform } from '@angular/core';
import { PermisosService } from '../services/Permisos/permisos.service';

@Pipe({
  name: 'hasPermission',
  standalone: true
})
export class HasPermissionPipe implements PipeTransform {
  constructor(private permisosService: PermisosService) {}

  transform(permiso: string): boolean {
    return this.permisosService.tienePermiso(permiso);
  }
}

// Usar en templates:
<button [disabled]="'TOURS.CREAR' | hasPermission | not">Crear</button>

---

// =====================================================
// 8. LISTENER DE CAMBIOS EN PERMISOS (TIEMPO REAL)
// =====================================================

// Escenario: Admin cambia permisos, usuario lo nota inmediatamente

// backend/websocket.js (agregar)
const permisosService = require('./services/Permisos/permisos.service');

wss.on('connection', (ws) => {
  ws.on('message', async (msg) => {
    const data = JSON.parse(msg);

    // Cuando se modifican permisos de un rol, notificar usuarios
    if (data.type === 'permissions-updated') {
      const affectedRole = data.idRol;
      
      // Broadcast a todos los clientes afectados
      wss.clients.forEach(client => {
        if (client.role === affectedRole) {
          client.send(JSON.stringify({
            type: 'refresh-permissions',
            message: 'Tus permisos han sido actualizados'
          }));
        }
      });
    }
  });
});

// frontend/app.ts (agregar)
this.ws.messages$.subscribe(msg => {
  if (msg.type === 'refresh-permissions') {
    // Recargar permisos
    this.permisosService.obtenerMisPermisos().subscribe(() => {
      alert('Tus permisos han sido actualizados');
    });
  }
});

---

// =====================================================
// 9. AUDITORÍA DE CAMBIOS EN PERMISOS (INTEGRACIÓN)
// =====================================================

// backend/services/Permisos/permisos.service.js (modificar)

const { recordHistorial } = require('../Historial/logger');

async function asignarPermisoARol(idRol, idPermiso, userId) {
  const conexion = await pool.getConnection();
  try {
    // Asignar permiso
    await conexion.query(`
      INSERT INTO rol_permisos (Id_Rol, Id_Permiso)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE Id_Rol = Id_Rol
    `, [idRol, idPermiso]);

    // Registrar en historial
    const [rol] = await conexion.query('SELECT * FROM roles WHERE Id_Rol = ?', [idRol]);
    const [permisos] = await conexion.query('SELECT * FROM permisos WHERE Id_Permiso = ?', [idPermiso]);

    await recordHistorial({
      conexion,
      tabla: 'rol_permisos',
      id_registro: `${idRol}_${idPermiso}`,
      accion: 'CREAR',
      id_usuario: userId,
      detalles: [
        {
          columna: 'Id_Rol',
          valor_anterior: '',
          valor_nuevo: idRol
        },
        {
          columna: 'Id_Permiso',
          valor_anterior: '',
          valor_nuevo: permisos[0].Codigo_Permiso
        }
      ]
    });

  } finally {
    conexion.release();
  }
}

---

// =====================================================
// 10. EXPORTAR LISTADO DE PERMISOS POR ROL
// =====================================================

// backend/controllers/Permisos/permisos.controller.js (agregar)

async function exportarPermisosPorRol(req, res) {
  try {
    const idRol = req.params.idRol;
    const formato = req.query.formato || 'json'; // json, csv, pdf

    const permisos = await permisosService.obtenerPermisosPorRol(idRol);

    if (formato === 'csv') {
      // Convertir a CSV
      const csv = [
        ['Modulo', 'Accion', 'Codigo Permiso', 'Descripcion'],
        ...permisos.map(p => [
          p.Nombre_Modulo,
          p.Accion,
          p.Codigo_Permiso,
          p.Descripcion
        ])
      ].map(row => row.join(',')).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="permisos_rol_${idRol}.csv"`);
      res.send(csv);
    } else {
      res.json({ permisos });
    }
  } catch (error) {
    res.status(500).json({
      error: 'Error al exportar permisos',
      mensaje: error.message
    });
  }
}

---

¡Estos ejemplos muestran cómo extender y usar el sistema RBAC en diferentes escenarios!
