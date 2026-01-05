import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { puntosService, Punto } from '../../../services/Puntos/puntos';
import { Reservas } from '../../../services/Reservas/reservas';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

@Component({
  selector: 'app-crear-punto',
  templateUrl: './crear-punto.html',
  styleUrls: ['./crear-punto.css'],
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, CommonModule]
})
export class CrearPuntoComponent {
  isLoading = false;
  successMsg = '';
  errorMsg = '';

  form;
  tours = signal<any[]>([]);
  horariosMap: Record<number | string, string> = {};
  newHorario: { Id_Tour: number | string; Hora_Salida: string } = { Id_Tour: '', Hora_Salida: '' };
  isDuplicate = false;
  duplicatePoint: any = null;
  private addrTimer: any = null;

  searchResults: any[] = [];
  constructor(private fb: FormBuilder, private puntos: puntosService, private router: Router, private reservasSvc: Reservas, private navbar: DynamicIslandGlobalService) {
    this.form = this.fb.group({
      NombrePunto: ['', [Validators.required, Validators.maxLength(255)]],
      Sector: ['', [Validators.required, Validators.maxLength(255)]],
      Direccion: ['', [Validators.required]],
      Latitud: [null, [Validators.required, Validators.min(-90), Validators.max(90)]],
      Longitud: [null, [Validators.required, Validators.min(-180), Validators.max(180)]]
    });
    // cargar tours para seleccionar en horarios (usa Reservas service para incluir auth)
    this.reservasSvc.getTours().subscribe({ next: t => this.tours.set(t || []), error: () => this.tours.set([]) });
    
  }

onSubmitCrearPunto() {
  if (this.isLoading) return;

  this.successMsg = '';
  this.errorMsg = '';

  // 1) validar form antes de preguntar
  if (this.form.invalid) {
    this.form.markAllAsTouched();

    const invalid = Object.keys(this.form.controls).filter(k => this.form.get(k)?.invalid);
    const friendly: Record<string, string> = {
      NombrePunto: 'Nombre del punto',
      Sector: 'Sector',
      Direccion: 'Dirección',
      Latitud: 'Latitud',
      Longitud: 'Longitud'
    };
    const fields = invalid.map(f => friendly[f] || f);
    const msg = fields.length
      ? `Revisa los siguientes campos: ${fields.join(', ')}`
      : 'Hay campos inválidos en el formulario.';

    this.navbar.alert?.set?.({
      type: 'error',
      title: 'Campos inválidos',
      message: msg,
      autoClose: false,
      buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) }]
    });
    return;
  }

  // 2) duplicado antes de preguntar
  if (this.isDuplicate) {
    this.navbar.alert?.set?.({
      type: 'error',
      title: 'Punto duplicado',
      message: 'Ya existe un punto con esa dirección',
      autoClose: false,
      buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) }]
    });
    return;
  }

  // 3) confirmación SOLO si todo está OK
  this.navbar.alert?.set?.({
    type: 'info',
    title: '¿Todo listo?',
    message: '¿Deseas crear este punto de recogida?',
    autoClose: false,
    buttons: [
      { text: 'Cancelar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) },
      { text: 'Crear', style: 'primary', onClick: () => { this.navbar.alert?.set?.(null); this.crearPuntoConfirmado(); } }
    ]
  });
}

// Se llama SOLO desde el botón "Crear" del modal
private crearPuntoConfirmado() {
  if (this.isLoading) return;

  // Seguridad extra: si algo cambió entre confirmación y click
  if (this.form.invalid || this.isDuplicate) return;

  this.isLoading = true;

  const payload: any = { ...this.form.value };
  payload.horarios = (this.tours() || []).map((t: any) => ({
    Id_Tour: t.Id_Tour,
    Hora_Salida: (this.horariosMap[t.Id_Tour] || '').trim() || 'Pendiente'
  }));

  this.puntos.crearPunto(payload).subscribe({
    next: () => {
      this.navbar.alert?.set?.({ type: 'success', title: 'Punto creado', message: 'Punto creado correctamente', autoClose: true });

      this.form.reset();
      this.isDuplicate = false;
      this.duplicatePoint = null;

      setTimeout(() => this.router.navigate(['/Puntos/VerPuntos']), 900);
    },
    error: (err: any) => {
    
      this.navbar.alert?.set?.({ type: 'error', title: 'Error', message: 'Error al crear el punto', autoClose: false });
    },
    complete: () => (this.isLoading = false)
  });
}


  onDireccionInput(v: string) {
    if (this.addrTimer) clearTimeout(this.addrTimer);
    const term = (v || '').trim();
    const ctrl = this.form.get('Direccion');
    if (!term) {
      this.isDuplicate = false;
      this.duplicatePoint = null;
      ctrl?.setErrors(null);
      this.navbar.alert?.set?.(null);
      return;
    }

    this.addrTimer = setTimeout(() => {
      // buscarPuntosPorDireccion busca por campo Direccion en el servidor
      this.puntos.buscarPuntosPorDireccion(term).subscribe({
        next: (res: any[]) => {
          const normTerm = this.normalizeAddr(term);
          const foundItem = Array.isArray(res)
            ? res.find(r => this.normalizeAddr(r?.Direccion || '') === normTerm)
            : null;

          if (foundItem) {
            this.isDuplicate = true;
            this.duplicatePoint = foundItem;
            ctrl?.setErrors({ duplicate: true });
            this.navbar.alert?.set?.({
              type: 'error',
              title: 'Punto duplicado',
              message: `${foundItem.Nombre_Punto || foundItem.NombrePunto || 'Punto'} — ${foundItem.Direccion || ''}`,
              autoClose: false,
              buttons: [
                { text: 'Ver punto', style: 'primary', onClick: () => { this.navbar.alert?.set?.(null); this.router.navigate(['/Puntos/VerPuntos'], { queryParams: { q: foundItem.Direccion || '' } }); } },
                { text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) }
              ]
            });
          } else {
            this.isDuplicate = false;
            this.duplicatePoint = null;
            ctrl?.setErrors(null);
            this.navbar.alert?.set?.(null);
          }
        },
        error: () => {
          this.isDuplicate = false;
          ctrl?.setErrors(null);
          this.navbar.alert?.set?.(null);
        }
      });
    }, 450);
  }

  // Normaliza una dirección: quita acentos, puntuación, múltiples espacios y pasa a minúsculas
  private normalizeAddr(s: string) {
    if (!s) return '';
    return s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  tourName(id: number) {
    const t = this.tours().find((x: any) => Number(x.Id_Tour) === Number(id));
    return t ? (t.Nombre_Tour || t.NombreTour || `Tour ${id}`) : `Tour ${id}`;
  }
}
