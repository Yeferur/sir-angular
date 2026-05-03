import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/Login/login-service';

@Component({
  selector: 'app-ayuda',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ayuda.html',
  styleUrls: ['./ayuda.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AyudaComponent implements OnInit {
  userName = signal('');

  constructor(private authService: AuthService) {}

  ngOnInit(): void {
    const user = this.authService.getUser();
    const fullName = `${String(user?.name || '').trim()} ${String(user?.apellidos || '').trim()}`.trim();
    this.userName.set(fullName);
  }

  getWhatsappUrl(): string {
    const nombre = this.userName().trim();
    const mensaje = nombre
      ? `Hola, soy ${nombre}. Necesito ayuda. Tengo un problema con la app SIR.`
      : 'Hola. Necesito ayuda. Tengo un problema con la app SIR.';

    return `https://wa.me/573025783379?text=${encodeURIComponent(mensaje)}`;
  }
}
