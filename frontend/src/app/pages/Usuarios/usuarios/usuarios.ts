import { Component, Signal } from '@angular/core';
import { UsuariosService } from '../../../services/Usuarios/usuarios';
import { CommonModule } from '@angular/common';
import type { Usuario } from '../../../services/Usuarios/usuarios';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './usuarios.html',
  styleUrl: './usuarios.css'
})
export class Usuarios {
  usuarios!: Signal<Usuario[]>;
  estados!: Signal<Map<string, string>>;

  constructor(private usuariosService: UsuariosService, private navbar: DynamicIslandGlobalService) {
    this.usuarios = this.usuariosService.getUsuariosSignal();
    this.estados = this.usuariosService.getEstadosSignal();
  }

  forzarCierreSesion(userId: string) {
    this.navbar.alert.set({
      type: 'warning',
      title: 'Cierre de Sesión',
      message: 'Estás a punto de cerrar la sesión de este usuario.',
      buttons: [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => this.navbar.alert.set(null)
        },
        {
          text: 'Cerrar Sesión',
          style: 'primary',
          onClick: () => {
            this.usuariosService.forzarCierreSesion(userId).subscribe({
              next: () => {
                console.log('✅ Sesión cerrada correctamente.');
                this.navbar.alert.set({
                  type: 'success',
                  title: 'Sesión Cerrada',
                  message: 'La sesión del usuario fue cerrada exitosamente.',
                  autoClose: true
                });
              },
              error: (err) => {
                console.error('❌ Error cerrando sesión:', err);
                this.navbar.alert.set({
                  type: 'error',
                  title: 'Error',
                  message: 'Ocurrió un error cerrando la sesión.'
                });
              }
            });
          }
        }
      ]
    });
  }
}
