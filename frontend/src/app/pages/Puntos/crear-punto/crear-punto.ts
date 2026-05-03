import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { puntosService } from '../../../services/Puntos/puntos';
import { Reservas } from '../../../services/Reservas/reservas';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

@Component({
  selector: 'app-crear-punto',
  templateUrl: './crear-punto.html',
  styleUrls: ['./crear-punto.css'],
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, CommonModule, RouterLink]
})
export class CrearPuntoComponent implements OnInit {
  isLoading = signal<boolean>(true);
  isSubmitting = signal<boolean>(false);
  successMsg = '';
  errorMsg = '';

  form!: FormGroup;
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
  }

  ngOnInit(): void {
    this.loadTours();
  }

  private loadTours(): void {
    this.isLoading.set(true);

    // Carga inicial de tours para configurar horarios por tour.
    this.reservasSvc.getTours().subscribe({
      next: t => this.tours.set(t || []),
      error: () => {
        this.tours.set([]);
        this.navbar.errorToast('Error', 'No se pudieron cargar los tours.');
        this.isLoading.set(false);
      },
      complete: () => this.isLoading.set(false)
    });
  }

async onSubmitCrearPunto() {
  if (this.isSubmitting()) return;

  this.successMsg = '';
  this.errorMsg = '';

  // ===== Validación del formulario ANTES de confirmar =====
  this.form.updateValueAndValidity({ emitEvent: false });
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

    this.navbar.alert.set({
      type: 'error',
      title: 'Campos requeridos incompletos',
      message: msg,
      autoClose: true,
      buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.alert.set(null) }]
    });
    return;
  }

  // 2) duplicado antes de preguntar
  if (this.isDuplicate) {
    this.navbar.warningToast('Punto duplicado', 'Ya existe un punto con esa dirección');
    return;
  }

  const confirmed = await this.requestCreatePointConfirmation();
  if (!confirmed) return;

  this.crearPuntoConfirmado();
}

private crearPuntoConfirmado() {
  if (this.isSubmitting()) return;

  // Seguridad extra: si algo cambió entre confirmación y click
  if (this.form.invalid || this.isDuplicate) return;

  this.isSubmitting.set(true);

  const payload: any = { ...this.form.value };
  payload.horarios = (this.tours() || []).map((t: any) => ({
    Id_Tour: t.Id_Tour,
    Hora_Salida: (this.horariosMap[t.Id_Tour] || '').trim() || 'Pendiente'
  }));

  this.puntos.crearPunto(payload).subscribe({
    next: () => {
      this.navbar.successToast('Punto creado', 'Punto creado correctamente');

      this.form.reset();
      this.form.markAsPristine();
      this.isDuplicate = false;
      this.duplicatePoint = null;
      this.router.navigate(['/Puntos/VerPuntos']);
    },
    error: (err: any) => {
      this.navbar.errorToast('Error', 'Error al crear el punto');
    },
    complete: () => {
      this.isSubmitting.set(false);
    }
  });
}

private buildCreatePointConfirmationMessage(): string {
  const nombrePunto = String(this.form.get('NombrePunto')?.value || '').trim() || 'el punto de encuentro';
  const sector = String(this.form.get('Sector')?.value || '').trim() || '—';
  const direccion = String(this.form.get('Direccion')?.value || '').trim() || '—';
  const cantidadTours = this.tours().length;

  return [
    `Vas a crear el punto de encuentro ${nombrePunto}.`,
    `Sector: ${sector}.`,
    `Dirección: ${direccion}.`,
    `Se configurarán horarios para ${cantidadTours} tours.`,
    '¿Deseas continuar?'
  ].join(' ');
}

private requestCreatePointConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    this.navbar.alert?.set?.({
      type: 'info',
      title: '¿Todo listo?',
      message: this.buildCreatePointConfirmationMessage(),
      autoClose: false,
      buttons: [
        {
          text: 'Cancelar',
          style: 'secondary',
          onClick: () => {
            this.navbar.alert?.set?.(null);
            resolve(false);
          }
        },
        {
          text: 'Guardar Punto',
          style: 'primary',
          onClick: () => {
            this.navbar.alert?.set?.(null);
            resolve(true);
          }
        }
      ]
    });
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
            this.navbar.warningToast('Punto duplicado', `${foundItem.Nombre_Punto || foundItem.NombrePunto || 'Punto'} - ${foundItem.Direccion || ''}`);
          } else {
            this.isDuplicate = false;
            this.duplicatePoint = null;
            ctrl?.setErrors(null);
          }
        },
        error: () => {
          this.isDuplicate = false;
          ctrl?.setErrors(null);
        }
      });
    }, 450);
  }

  hasUnsavedChanges(): boolean {
    return this.form?.dirty && !this.isSubmitting();
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
