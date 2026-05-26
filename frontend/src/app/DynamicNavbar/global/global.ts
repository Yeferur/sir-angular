import { Component, HostListener, computed, inject, OnDestroy, OnInit, NgZone } from '@angular/core';
import { environment } from '../../../environments/environment';

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
  private zone = inject(NgZone);
  readonly aiEnabled = !!environment.aiEnabled;

  // ─── Comet animation ───────────────────────────────────────────
  private cometRaf?: number;
  private cometOffset = 0;
  private cometPerimeter = 2400;
  private readonly COMET_LEN = 280;
  private readonly COMET_SPEED = 2.6;
  private cometColorIdx = 0;
  private readonly COMET_COLORS: [string, string][] = [
    ['#0a84ff', '#30d158'],
    ['#30d158', '#ffd60a'],
    ['#ffd60a', '#bf5af2'],
    ['#bf5af2', '#0a84ff'],
  ];

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
    this.stopComet();
  }

  clearPreview() {
    this.global.closePreview();
  }

  openAppUpdates() {
    this.global.openAppUpdates();
  }

  openGlobalSearch() {
    this.global.openGlobalSearch();
    // Iniciar cometa después de que el DOM se actualice
    setTimeout(() => this.zone.runOutsideAngular(() => this.startComet()), 50);
  }

  closeGlobalSearch() {
    this.global.closeGlobalSearch();
    this.stopComet();
  }

  compactSearchAriaLabel(): string | null {
    return this.islandState() === 'compact'
      ? (this.aiEnabled ? 'Abrir buscador con IA' : 'Abrir buscador global')
      : null;
  }

  searchAriaLabel(): string {
    return this.aiEnabled ? 'Buscador con IA' : 'Buscador global';
  }


  private startComet(): void {
    this.stopComet();
    const svg    = document.querySelector<SVGSVGElement>('#sir-comet-svg');
    const rect   = document.querySelector<SVGRectElement>('#sir-comet-rect');
    const grad   = document.querySelector<SVGLinearGradientElement>('#sir-comet-g');
    if (!svg || !rect || !grad) return;

    // Sincronizar tamaño
    const islandEl = svg.nextElementSibling as HTMLElement | null;
    const w = islandEl?.offsetWidth || 700;
    const h = islandEl?.offsetHeight || 600;
    const r = 27;
    this.cometPerimeter = 2*(w-2*r) + 2*(h-2*r) + 2*Math.PI*r;
    rect.setAttribute('width',  String(w - 2));
    rect.setAttribute('height', String(h - 2));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.style.width  = `${w}px`;
    svg.style.height = `${h}px`;

    this.cometOffset = this.COMET_LEN;
    this.cometColorIdx = 0;
    this.updateCometGradient(grad);

    const loop = () => {
      this.cometOffset -= this.COMET_SPEED;
      if (this.cometOffset <= -this.cometPerimeter) {
        this.cometOffset = this.COMET_LEN;
        this.cometColorIdx++;
        this.updateCometGradient(grad);
      }
      const gap = this.cometPerimeter - this.COMET_LEN;
      rect.style.strokeDasharray  = `${this.COMET_LEN} ${gap}`;
      rect.style.strokeDashoffset = String(this.cometOffset);
      this.cometRaf = requestAnimationFrame(loop);
    };
    this.cometRaf = requestAnimationFrame(loop);
  }

  private stopComet(): void {
    if (this.cometRaf) {
      cancelAnimationFrame(this.cometRaf);
      this.cometRaf = undefined;
    }
  }

  private updateCometGradient(grad: SVGLinearGradientElement): void {
    const [head, tail] = this.COMET_COLORS[this.cometColorIdx % this.COMET_COLORS.length];
    grad.innerHTML = `
      <stop offset="0%"   stop-color="${tail}" stop-opacity="0"/>
      <stop offset="25%"  stop-color="${tail}" stop-opacity="0.3"/>
      <stop offset="60%"  stop-color="${head}" stop-opacity="1"/>
      <stop offset="80%"  stop-color="${head}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${head}" stop-opacity="0"/>
    `;
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
