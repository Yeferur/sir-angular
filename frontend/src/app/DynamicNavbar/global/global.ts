import { Component, computed, inject, ChangeDetectorRef, OnInit, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { RouterLink } from '@angular/router';

// Importa los nuevos componentes de contenido
import { AlertContentComponent } from '../Alertas/alertas';
import { CuposWidgetComponent } from '../cupos/cupos';
// Importa tu servicio global
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';
import { LoginContentComponent } from '../login/login';
// Importa otros componentes que necesites mostrar, como Login, Mapa, etc.
// import { Login } from '../login/login'; 
import { Mapa } from '../mapa/mapa';
import { ReservasDynamicComponent } from '../reserva/reserva';
import { Combinaciones } from '../combinaciones/combinaciones';
import { PreviewComponent } from '../preview/preview';
import { DuplicarPanelComponent } from '../duplicar-panel/duplicar-panel';

@Component({
  selector: 'app-dynamic-navbar', // Renombrado para mayor claridad
  standalone: true,
  imports: [
    RouterLink,
    AlertContentComponent,
    CuposWidgetComponent,
    LoginContentComponent,
    ReservasDynamicComponent,
    Mapa,
    Combinaciones,
    PreviewComponent,
    DuplicarPanelComponent
],
  templateUrl: './global.html',
  styleUrls: ['./global.css'],
})
export class DynamicNavbarComponent implements OnInit {
  private global = inject(DynamicIslandGlobalService);
  private sanitizer = inject(DomSanitizer);

  // Exponer panel para el template
  panel = this.global.panel;

  // Signals del servicio
  mode = this.global.mode;
  alert = this.global.alert;
  cuposInfo = this.global.cuposInfo;
  reserva = this.global.Id_Reserva;
  mapa = this.global.puntos;
  sugerencias = this.global.sugerencias
  preview = this.global.previewUrl;
  previewTitle = this.global.previewTitle;

  isDarkMode = true;

  // El signal computado ahora maneja el estado 'login'
  islandState = computed(() => {
    // preview has priority when set
    if (this.global.previewUrl()) return 'preview';
    if (this.global.panel()) return 'panel';
    if (this.mode() === 'login') return 'full-screen'; // El login usa el estado full-screen
    if (this.alert()?.loading) return 'loading';
    if (this.alert()) return 'alert';
    if (this.cuposInfo()) return 'cupos';
    if (this.reserva()) return 'reserva';
    if (this.mapa()) return 'mapa';
    if (this.sugerencias()) return 'sugerencias';
    return 'compact';
  });

  safePreviewUrl = computed((): SafeResourceUrl | null => {
    const u = this.global.previewUrl();
    if (!u) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(u);
  });

  ngOnInit(): void {
    // Lógica para detectar el tema (sin cambios)
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

  clearAlert() {
    this.global.alert.set(null);
  }

  clearReserva() {
    this.global.Id_Reserva.set(null);
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
