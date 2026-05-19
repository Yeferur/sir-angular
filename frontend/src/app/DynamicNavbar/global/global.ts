import { Component, HostListener, computed, inject, OnDestroy, OnInit } from '@angular/core';

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
import { GlobalSearchComponent } from '../global-search/global-search';

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
    AppUpdatesPanelComponent,
    GlobalSearchComponent
],
  templateUrl: './global.html',
  styleUrls: ['./global.css'],
})
export class DynamicNavbarComponent implements OnInit, OnDestroy {
  private global = inject(DynamicIslandGlobalService);

  panel = this.global.panel;

  mode = this.global.mode;
  overlay = this.global.overlay;
  alert = this.global.alert;
  cuposInfo = this.global.cuposInfo;
  toasts = this.global.toasts;
  reserva = this.global.Id_Reserva;
  transfer = this.global.Id_Transfer;
  mapa = this.global.puntos;
  sugerencias = this.global.sugerencias
  preview = this.global.previewUrl;
  previewTitle = this.global.previewTitle;
  globalSearchOpen = this.global.globalSearchOpen;

  isDarkMode = true;
  private themeObserver?: MutationObserver;

  baseState = computed(() => {
    if (this.mode() === 'login') return 'full-screen';
    if (this.globalSearchOpen()) return 'global-search';
    if (this.global.panel()) return 'panel';
    if (this.cuposInfo()) return 'cupos';
    if (this.reserva()) return 'reserva';
    if (this.transfer()) return 'transfer';
    if (Array.isArray(this.mapa()) && this.mapa().length > 0) return 'mapa';
    return 'compact';
  });

  overlayState = computed(() => {
    const overlay = this.overlay();
    if (!overlay) return null;
    return overlay.loading ? 'loading' : 'alert';
  });

  islandState = computed(() => {
    return this.overlayState() ?? this.baseState();
  });

  ngOnInit(): void {
    const theme = document.documentElement.getAttribute('data-theme');
    this.isDarkMode = theme !== 'light';
    this.themeObserver = new MutationObserver(() => {
      const updatedTheme = document.documentElement.getAttribute('data-theme');
      this.isDarkMode = updatedTheme !== 'light';
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  ngOnDestroy(): void {
    this.themeObserver?.disconnect();
  }

  clearPreview() {
    this.global.closePreview();
  }

  openAppUpdates() {
    this.global.openAppUpdates();
  }

  openGlobalSearch() {
    this.global.openGlobalSearch();
  }

  closeGlobalSearch() {
    this.global.closeGlobalSearch();
  }

  @HostListener('document:keydown', ['$event'])
  handleGlobalShortcuts(event: KeyboardEvent) {
    if (this.mode() === 'login') return;

    const target = event.target as HTMLElement | null;
    const tagName = target?.tagName?.toLowerCase() || '';
    const editable = tagName === 'input' || tagName === 'textarea' || target?.isContentEditable;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.openGlobalSearch();
      return;
    }

    if (event.key === 'Escape' && this.globalSearchOpen()) {
      if (editable && !target?.closest('app-global-search')) return;
      event.preventDefault();
      this.closeGlobalSearch();
    }
  }

  clearOverlay() {
    this.global.clearOverlay();
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
