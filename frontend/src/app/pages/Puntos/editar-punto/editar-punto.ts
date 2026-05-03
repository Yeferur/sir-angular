import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { puntosService, Punto } from '../../../services/Puntos/puntos';
import { Reservas } from '../../../services/Reservas/reservas';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

@Component({
  selector: 'app-editar-punto',
  templateUrl: './editar-punto.html',
  styleUrls: ['../crear-punto/crear-punto.css'],
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, CommonModule, RouterLink]
})
export class EditarPuntoComponent implements OnInit {
  isLoading = signal(true);
  isSubmitting = signal(false);
  successMsg = '';
  errorMsg = '';

  form: any;
  tours = signal<any[]>([]);
  horariosMap: Record<number | string, string> = {};
  isDuplicate = false;
  duplicatePoint: any = null;
  private addrTimer: any = null;
  puntoId: number | null = null;
  private toursLoaded = false;
  private puntoLoaded = false;

  constructor(private fb: FormBuilder, private puntos: puntosService, private route: ActivatedRoute, private router: Router, private reservasSvc: Reservas, private navbar: DynamicIslandGlobalService) {
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
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.puntoId = Number(idParam);
      this.loadPunto(this.puntoId);
    } else {
      this.navbar.errorToast('Error', 'ID de punto inválido');
      this.puntoLoaded = true;
      this.markInitialLoadDone();
    }
  }

  private loadTours(): void {
    this.isLoading.set(true);
    this.reservasSvc.getTours().subscribe({
      next: t => this.tours.set(t || []),
      error: () => {
        this.tours.set([]);
        this.toursLoaded = true;
        this.navbar.errorToast('Error', 'No se pudieron cargar los tours.');
        this.markInitialLoadDone();
      },
      complete: () => {
        this.toursLoaded = true;
        this.markInitialLoadDone();
      }
    });
  }

  private loadPunto(id: number) {
    this.isLoading.set(true);
    this.puntos.getPunto(id).subscribe({
      next: (p: Punto) => {
        this.form.patchValue({
          NombrePunto: p.NombrePunto || p.Nombre_Punto || '',
          Sector: p.Sector || '',
          Direccion: p.Direccion || '',
          Latitud: p.Latitud ? Number(p.Latitud) : null,
          Longitud: p.Longitud ? Number(p.Longitud) : null
        });
        // Cargar horarios si vienen del backend
        if ((p as any).horarios && Array.isArray((p as any).horarios)) {
          for (const h of (p as any).horarios) {
            if (h?.Id_Tour != null) this.horariosMap[h.Id_Tour] = h.HoraSalida || h.Hora_Salida || '';
          }
        }
        this.puntoLoaded = true;
        this.markInitialLoadDone();
      },
      error: () => {
        this.navbar.errorToast('Error', 'No se pudo cargar el punto');
        this.puntoLoaded = true;
        this.markInitialLoadDone();
      },
      complete: () => {
        this.puntoLoaded = true;
        this.markInitialLoadDone();
      }
    });
  }

  private markInitialLoadDone(): void {
    if (this.toursLoaded && this.puntoLoaded) {
      this.isLoading.set(false);
    }
  }

async onSubmitGuardarCambios() {
  if (this.isSubmitting()) return;

  // ===== Validación del formulario ANTES de confirmar =====
  this.form.updateValueAndValidity({ emitEvent: false });

  if (this.form.invalid) {
    this.form.markAllAsTouched();
    const invalid = Object.keys(this.form.controls).filter(k => this.form.get(k)?.invalid);
    const friendly: Record<string,string> = {
      NombrePunto: 'Nombre del punto',
      Sector: 'Sector',
      Direccion: 'Dirección',
      Latitud: 'Latitud',
      Longitud: 'Longitud'
    };
    const fields = invalid.map(f => friendly[f] || f);
    const msg = fields.length ? `Revisa los siguientes campos: ${fields.join(', ')}` : 'Hay campos inválidos en el formulario.';

    this.navbar.alert.set({
      type: 'error',
      title: 'Campos requeridos incompletos',
      message: msg,
      autoClose: true,
      buttons: [{ text: 'Entendido', style: 'primary', onClick: () => this.navbar.alert.set(null) }]
    });
    return;
  }

  if (!this.puntoId) return;

  const confirmed = await this.requestUpdatePointConfirmation();
  if (!confirmed) return;

  this.guardarCambiosConfirmado();
}

private guardarCambiosConfirmado() {
  if (this.isSubmitting()) return;
  if (!this.puntoId) return;
  if (this.form.invalid) return; // seguridad extra

  this.isSubmitting.set(true);

  const payload: any = { ...this.form.value };
  payload.horarios = (this.tours() || []).map((t: any) => ({
    Id_Tour: t.Id_Tour,
    Hora_Salida: (this.horariosMap[t.Id_Tour] || '').trim() || 'Pendiente'
  }));
  this.puntos.updatePunto(this.puntoId, payload).subscribe({
    next: () => {
      this.successMsg = 'Punto actualizado correctamente';
      this.navbar.successToast('Punto actualizado', this.successMsg);
      this.form.markAsPristine();
      this.router.navigate(['/Puntos/VerPuntos']);
    },
    error: (err: any) => {
      this.errorMsg = err?.error?.message || 'Error al actualizar el punto';
      this.navbar.errorToast('Error', this.errorMsg);
    },
    complete: () => {
      this.isSubmitting.set(false);
    }
  });
}

private buildUpdatePointConfirmationMessage(): string {
  const nombrePunto = String(this.form.get('NombrePunto')?.value || '').trim() || 'el punto de encuentro';
  const sector = String(this.form.get('Sector')?.value || '').trim() || '—';
  const direccion = String(this.form.get('Direccion')?.value || '').trim() || '—';
  const cantidadTours = this.tours().length;

  return [
    `Vas a guardar los cambios del punto de encuentro ${nombrePunto}.`,
    `Sector: ${sector}.`,
    `Dirección: ${direccion}.`,
    `Se mantendrán horarios para ${cantidadTours} tours.`,
    '¿Deseas continuar?'
  ].join(' ');
}

private requestUpdatePointConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    this.navbar.alert?.set?.({
      type: 'info',
      title: '¿Todo listo?',
      message: this.buildUpdatePointConfirmationMessage(),
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
          text: 'Guardar cambios',
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
      this.puntos.buscarPuntosPorDireccion(term).subscribe({
        next: (res: any[]) => {
          const normTerm = this.normalizeAddr(term);
          const foundItem = Array.isArray(res) ? res.find(r => this.normalizeAddr(r?.Direccion || '') === normTerm) : null;
          if (foundItem && Number(foundItem.Id_Punto) !== Number(this.puntoId)) {
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
        error: () => { this.isDuplicate = false; ctrl?.setErrors(null); }
      });
    }, 450);
  }

  hasUnsavedChanges(): boolean {
    return this.form?.dirty && !this.isSubmitting();
  }

  private normalizeAddr(s: string) {
    if (!s) return '';
    return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }
}
