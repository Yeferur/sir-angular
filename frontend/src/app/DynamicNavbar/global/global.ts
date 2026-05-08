import { Component, computed, inject, ChangeDetectorRef, OnInit, OnDestroy } from '@angular/core';

import { RouterLink } from '@angular/router';

import { AlertContentComponent } from '../Alertas/alertas';
import { CuposWidgetComponent } from '../cupos/cupos';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';
import { LoginContentComponent } from '../login/login';
import { Mapa } from '../mapa/mapa';
import { ReservasDynamicComponent } from '../reserva/reserva';
import { TransferDynamicComponent } from '../transfer/transfer';
import { DuplicarPanelComponent } from '../duplicar-panel/duplicar-panel';
import { AppUpdatesPanelComponent } from '../app-updates-panel/app-updates-panel';

@Component({
  selector: 'app-dynamic-navbar',
  standalone: true,
  imports: [
    RouterLink,
    AlertContentComponent,
    CuposWidgetComponent,
    LoginContentComponent,
    ReservasDynamicComponent,
    TransferDynamicComponent,
    Mapa,
    DuplicarPanelComponent,
    AppUpdatesPanelComponent
],
  templateUrl: './global.html',
  styleUrls: ['./global.css'],
})
export class DynamicNavbarComponent implements OnInit {
  private global = inject(DynamicIslandGlobalService);

  panel = this.global.panel;

  mode = this.global.mode;
  alert = this.global.alert;
  cuposInfo = this.global.cuposInfo;
  toasts = this.global.toasts;
  reserva = this.global.Id_Reserva;
  transfer = this.global.Id_Transfer;
  mapa = this.global.puntos;
  sugerencias = this.global.sugerencias
  preview = this.global.previewUrl;
  previewTitle = this.global.previewTitle;

  isDarkMode = true;

  islandState = computed(() => {
    if (this.global.panel()) return 'panel';
    if (this.mode() === 'login') return 'full-screen';
    if (this.alert()?.loading) return 'loading';
    if (this.alert()) return 'alert';
    if (this.cuposInfo()) return 'cupos';
    if (this.reserva()) return 'reserva';
    if (this.transfer()) return 'transfer';
  
    if (Array.isArray(this.mapa()) && this.mapa().length > 0) return 'mapa';
    return 'compact';
  });

  ngOnInit(): void {
    const theme = document.documentElement.getAttribute('data-theme');
    this.isDarkMode = theme !== 'light';
    const observer = new MutationObserver(() => {
      const updatedTheme = document.documentElement.getAttribute('data-theme');
      this.isDarkMode = updatedTheme !== 'light';
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  clearPreview() {
    this.global.closePreview();
  }

  openAppUpdates() {
    this.global.openAppUpdates();
  }

  clearAlert() {
    this.global.alert.set(null);
  }

  dismissToast(id: string) {
    this.global.dismissToast(id);
  }

  toastsList() {
    return this.toasts();
  }

  clearReserva() {
    this.global.Id_Reserva.set(null);
  }

  clearTransfer() {
    this.global.Id_Transfer.set(null);
  }

  clearPuntos() {
    this.global.puntos.set(null);
  }

  clearCombinaciones() {
    this.global.sugerencias.set(null);
  }

  seleccionarSugerenciaDesdeNavbar(sugerencia: any) {
    this.global.confirmarSugerenciaDesdeNavbar(sugerencia);
  }

  generarManual(manual: any) {
    this.global.generarCombincionManual(manual);
  }
}
