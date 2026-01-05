import { Injectable, signal } from '@angular/core';

export interface User {
  name: string;
  apellidos: string;
  email: string;
  id_user: string;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  // Inicialmente sin sesión
  user = signal<User | null>(null);

  /**
   * Actualiza el usuario
   */
  setUser(userData: User) {
    this.user.set(userData);
  }

  /**
   * Limpia la sesión del usuario
   */
  clearUser() {
    this.user.set(null);
  }
}
