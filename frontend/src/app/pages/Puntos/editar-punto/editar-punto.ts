import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { puntosService, Punto } from '../../../services/Puntos/puntos';
import { Reservas } from '../../../services/Reservas/reservas';
import { DynamicIslandGlobalService } from '../../../services/DynamicNavbar/global';

@Component({
  selector: 'app-editar-punto',
  templateUrl: './editar-punto.html',
  styleUrls: ['../crear-punto/crear-punto.css'],
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, CommonModule]
})
export class EditarPuntoComponent implements OnInit {
  isLoading = false;
  successMsg = '';
  errorMsg = '';

  form: any;
  tours = signal<any[]>([]);
  horariosMap: Record<number | string, string> = {};
  isDuplicate = false;
  duplicatePoint: any = null;
  private addrTimer: any = null;
  puntoId: number | null = null;

  constructor(private fb: FormBuilder, private puntos: puntosService, private route: ActivatedRoute, private router: Router, private reservasSvc: Reservas, private navbar: DynamicIslandGlobalService) {
    this.form = this.fb.group({
      NombrePunto: ['', [Validators.required, Validators.maxLength(255)]],
      Sector: ['', [Validators.required, Validators.maxLength(255)]],
      Direccion: ['', [Validators.required]],
      Latitud: [null, [Validators.required, Validators.min(-90), Validators.max(90)]],
      Longitud: [null, [Validators.required, Validators.min(-180), Validators.max(180)]]
    });

    this.reservasSvc.getTours().subscribe({ next: t => this.tours.set(t || []), error: () => this.tours.set([]) });
  }

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.puntoId = Number(idParam);
      this.loadPunto(this.puntoId);
    }
  }

  private loadPunto(id: number) {
    this.isLoading = true;
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
        console.log('Punto cargado para edición:', p);
      },
      error: () => {
        this.navbar.alert?.set?.({ type: 'error', title: 'Error', message: 'No se pudo cargar el punto', autoClose: false });
      },
      complete: () => (this.isLoading = false)
    });
  }

onSubmitGuardarCambios() {
  if (this.isLoading) return;


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

    this.navbar.alert?.set?.({
      type: 'error',
      title: 'Campos inválidos',
      message: msg,
      autoClose: false,
      buttons: [{ text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) }]
    });
    return;
  }

  if (!this.puntoId) return;

  this.navbar.alert?.set?.({
    type: 'info',
    title: 'Confirmar cambios',
    message: '¿Deseas guardar los cambios de este punto?',
    autoClose: false,
    buttons: [
      { text: 'Cancelar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) },
      { text: 'Guardar', style: 'primary', onClick: () => { this.navbar.alert?.set?.(null); this.guardarCambiosConfirmado(); } }
    ]
  });
}

private guardarCambiosConfirmado() {
  if (this.isLoading) return;
  if (!this.puntoId) return;
  if (this.form.invalid) return; // seguridad extra

  this.isLoading = true;

  const payload: any = { ...this.form.value };
  payload.horarios = (this.tours() || []).map((t: any) => ({
    Id_Tour: t.Id_Tour,
    Hora_Salida: (this.horariosMap[t.Id_Tour] || '').trim() || 'Pendiente'
  }));
console.log('Payload para actualizar punto:', payload);
  this.puntos.updatePunto(this.puntoId, payload).subscribe({
    next: () => {
      this.successMsg = 'Punto actualizado correctamente';
      this.navbar.alert?.set?.({ type: 'success', title: 'Punto actualizado', message: this.successMsg, autoClose: true });
      setTimeout(() => this.router.navigate(['/Puntos/VerPuntos']), 700);
    },
    error: (err: any) => {
      this.errorMsg = err?.error?.message || 'Error al actualizar el punto';
      this.navbar.alert?.set?.({ type: 'error', title: 'Error', message: this.errorMsg, autoClose: false });
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
      this.puntos.buscarPuntosPorDireccion(term).subscribe({
        next: (res: any[]) => {
          const normTerm = this.normalizeAddr(term);
          const foundItem = Array.isArray(res) ? res.find(r => this.normalizeAddr(r?.Direccion || '') === normTerm) : null;
          if (foundItem && Number(foundItem.Id_Punto) !== Number(this.puntoId)) {
            this.isDuplicate = true;
            this.duplicatePoint = foundItem;
            ctrl?.setErrors({ duplicate: true });
            this.navbar.alert?.set?.({ type: 'error', title: 'Punto duplicado', message: `${foundItem.Nombre_Punto || foundItem.NombrePunto || 'Punto'} — ${foundItem.Direccion || ''}`, autoClose: false, buttons: [{ text: 'Ver punto', style: 'primary', onClick: () => { this.navbar.alert?.set?.(null); this.router.navigate(['/Puntos/VerPuntos'], { queryParams: { q: foundItem.Direccion || '' } }); } }, { text: 'Cerrar', style: 'secondary', onClick: () => this.navbar.alert?.set?.(null) }] });
          } else {
            this.isDuplicate = false;
            this.duplicatePoint = null;
            ctrl?.setErrors(null);
            this.navbar.alert?.set?.(null);
          }
        },
        error: () => { this.isDuplicate = false; ctrl?.setErrors(null); this.navbar.alert?.set?.(null); }
      });
    }, 450);
  }

  private normalizeAddr(s: string) {
    if (!s) return '';
    return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }
}
