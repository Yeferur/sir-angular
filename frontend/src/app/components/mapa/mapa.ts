import {
  Component,
  Input,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  ChangeDetectorRef
} from '@angular/core';

import * as L from 'leaflet';
import 'leaflet-routing-machine';
import { CommonModule } from '@angular/common';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { ProgramacionDashboardService } from '../../services/Programacion/programacion';

declare module 'leaflet' {
  namespace Routing {
    function control(options: any): any;
  }
}

interface PuntoAgrupado {
  lat: number;
  lng: number;
  reservas: any[];
  NombrePunto?: string;
  esDestinoTour?: boolean;
  // Suma de __paxEnEstePunto de las reservas en este punto.
  // Puede diferir del total de NumeroPasajeros cuando una reserva
  // tiene pasajeros repartidos en múltiples puntos de la misma ruta.
  totalPaxEnEstePunto: number;
}

interface DestinoTourMapa {
  lat: number;
  lng: number;
  nombre?: string | null;
}

interface PuntoSinCoordenadas {
  nombre: string;
  idReserva: string;
  pasajeros: number;
}

@Component({
  selector: 'app-mapa',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mapa.html',
  styleUrls: ['./mapa.css']
})
export class Mapa implements OnInit, OnDestroy {
  @Input() puntos: any[] = [];
  @Input() destino: DestinoTourMapa | null = null;
  @Output() onClose = new EventEmitter<void>();
  @ViewChild('mapaDiv') mapContainer!: ElementRef<HTMLDivElement>;

  // ── Estado del panel lateral ─────────────────────────────────
  agrupadosConBase: PuntoAgrupado[] = [];
  paradaActivaIndex: number | null = null;
  distanciaKm: string = '—';
  tiempoMin: string = '—';
  totalPax: number = 0;
  puntosSinCoordenadas: PuntoSinCoordenadas[] = [];
  mapTheme: 'dark' | 'light' =
    typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light'
      ? 'light'
      : 'dark';

  private map!: L.Map;
  private routingControl!: any;
  private markers: L.Marker[] = [];
  private tileLayer?: L.TileLayer;
  private initRetryHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private alerts: SirAlertService,
    private cdr: ChangeDetectorRef,
    private programacion: ProgramacionDashboardService
  ) {}

  cerrar() {
    this.onClose.emit();
  }

  ngOnInit(): void {
    this.scheduleMapInit();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['puntos']) return;
    if (!this.mapContainer?.nativeElement) return;
    this.scheduleMapInit({ reset: true });
  }

  ngOnDestroy(): void {
    if (this.initRetryHandle) {
      clearTimeout(this.initRetryHandle);
      this.initRetryHandle = null;
    }
    this.map?.remove();
  }

  // ── Seleccionar parada desde el panel ───────────────────────
  seleccionarParada(index: number): void {
    this.paradaActivaIndex = index;
    const punto = this.agrupadosConBase[index];
    if (punto && this.map) {
      this.map.setView([punto.lat, punto.lng], 16, { animate: true });
      this.markers[index]?.openPopup();
    }
  }

  totalPaxPunto(punto: PuntoAgrupado): number {
    // Usar el pre-calculado si existe (más eficiente y correcto para multi-punto).
    if (typeof punto.totalPaxEnEstePunto === 'number') return punto.totalPaxEnEstePunto;
    // Fallback: sumar NumeroPasajeros total (reservas de un solo punto).
    return punto.reservas.reduce((sum, r) => sum + (Number(r.NumeroPasajeros) || 0), 0);
  }

  toggleMapTheme(): void {
    this.mapTheme = this.mapTheme === 'dark' ? 'light' : 'dark';
    this.applyTileLayer();
    this.cdr.markForCheck();
  }

  // ── Init del mapa ────────────────────────────────────────────
  private initMap(): void {
    if (this.map) {
      this.map.remove();
      this.map = undefined as any;
    }
    this.routingControl = undefined;
    this.markers = [];
    this.puntosSinCoordenadas = [];

    if (!Array.isArray(this.puntos) || this.puntos.length === 0) return;

    // ── Expandir reservas multi-punto ─────────────────────────
    // Una reserva con puntosReserva[] (ej: 5 pax en Punto A y 5 en Punto B)
    // debe generar UNA entrada por punto en el mapa, no una sola por reserva.
    // Generamos entradas "planas" para que la agrupación por coordenada funcione.
    interface EntradaMapa {
      Id_Reserva: any;
      NumeroPasajeros: number;
      __paxEnEstePunto: number;
      Id_Punto: any;
      NombrePunto: string;
      Latitud: number | null;
      Longitud: number | null;
    }

    const entradasMapa: EntradaMapa[] = [];
    for (const r of this.puntos) {
      if (Array.isArray(r.puntosReserva) && r.puntosReserva.length > 0) {
        // Reserva multi-punto: generar una entrada por cada sub-punto
        for (const punto of r.puntosReserva) {
          entradasMapa.push({
            Id_Reserva: r.Id_Reserva,
            NumeroPasajeros: r.NumeroPasajeros,
            __paxEnEstePunto: Number(punto.pasajeros ?? 0),
            Id_Punto: punto.Id_Punto,
            NombrePunto: punto.NombrePunto ?? r.NombrePunto ?? '',
            Latitud: punto.Latitud !== undefined ? Number(punto.Latitud) : null,
            Longitud: punto.Longitud !== undefined ? Number(punto.Longitud) : null,
          });
        }
      } else {
        // Reserva de un solo punto: entrada directa
        entradasMapa.push({
          Id_Reserva: r.Id_Reserva,
          NumeroPasajeros: r.NumeroPasajeros,
          __paxEnEstePunto: r.__paxEnEstePunto ?? r.NumeroPasajeros,
          Id_Punto: r.Id_Punto,
          NombrePunto: r.NombrePunto ?? '',
          Latitud: r.Latitud !== undefined ? Number(r.Latitud) : null,
          Longitud: r.Longitud !== undefined ? Number(r.Longitud) : null,
        });
      }
    }

    // ── Agrupar por coordenada ─────────────────────────────────
    const puntosAgrupados = new Map<string, PuntoAgrupado>();

    for (const r of entradasMapa) {
      const lat = this.toNumber(r.Latitud);
      const lng = this.toNumber(r.Longitud);

      if (
        lat === null || lng === null ||
        Math.abs(lat) < 1e-4 || Math.abs(lng) < 1e-4 ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) {
        this.puntosSinCoordenadas.push({
          nombre: r.NombrePunto || `Punto ${r.Id_Punto ?? 'sin identificar'}`,
          idReserva: String(r.Id_Reserva ?? ''),
          pasajeros: Number(r.__paxEnEstePunto || r.NumeroPasajeros || 0)
        });
        continue;
      }

      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      if (!puntosAgrupados.has(key)) {
        puntosAgrupados.set(key, {
          lat,
          lng,
          NombrePunto: r.NombrePunto || `Punto ${r.Id_Punto ?? ''}`,
          reservas: [],
          totalPaxEnEstePunto: 0
        });
      }
      const grupo = puntosAgrupados.get(key)!;
      grupo.reservas.push(r);
      grupo.totalPaxEnEstePunto += r.__paxEnEstePunto;
    }

    const agrupados = Array.from(puntosAgrupados.values());

    // ── Insertar Estación Poblado como inicio ──────────────────
    const baseLat = 6.212757856694648;
    const baseLng = -75.57759200491337;
    const baseKey = `${baseLat.toFixed(5)},${baseLng.toFixed(5)}`;
    const agrupadosSinBase = agrupados.filter(p =>
      `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` !== baseKey
    );
    this.agrupadosConBase = [
      { lat: baseLat, lng: baseLng, NombrePunto: 'Estación Poblado', reservas: [], totalPaxEnEstePunto: 0 },
      ...agrupadosSinBase
    ];

    const destinoTour = this.normalizarDestinoTour();
    if (destinoTour) {
      const destinoKey = `${destinoTour.lat.toFixed(5)},${destinoTour.lng.toFixed(5)}`;
      const yaExiste = this.agrupadosConBase.some(
        p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` === destinoKey
      );

      if (!yaExiste) {
        this.agrupadosConBase.push({
          lat: destinoTour.lat,
          lng: destinoTour.lng,
          NombrePunto: destinoTour.nombre || 'Destino del tour',
          reservas: [],
          totalPaxEnEstePunto: 0,
          esDestinoTour: true
        });
      }
    }

    // Calcular total de pasajeros para el panel
    this.totalPax = this.agrupadosConBase.reduce(
      (sum, p) => sum + this.totalPaxPunto(p), 0
    );

    const waypoints = this.agrupadosConBase.map(p => L.latLng(p.lat, p.lng));

    if (waypoints.length < 2) {
      this.alerts.warningToast('Coordenadas inválidas', 'Menos de 2 puntos válidos con coordenadas.');
      this.onClose.emit();
      return;
    }

    // ── Crear mapa con tile oscuro ─────────────────────────────
    const center = waypoints[0]!;
    this.map = L.map(this.mapContainer.nativeElement, {
      zoomControl: false  // lo añadimos nosotros con posición custom
    }).setView(center, 13);

    this.applyTileLayer();

    // Zoom control en posición bottom-left
    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

    // ── Routing ───────────────────────────────────────────────
    const Routing = (L as any).Routing || (window as any).L?.Routing;

    if (!Routing) {
      this.alerts.errorToast('Error de mapa', 'No se pudo cargar el módulo de rutas (Leaflet Routing Machine).');
      return;
    }

    this.routingControl = Routing.control({
      waypoints,
      router: this.osrmRouter(),
      addWaypoints: false,
      routeWhileDragging: false,
      show: false,
      containerClassName: '',
      // Línea de ruta: azul acorde al design system de Maxitours
      lineOptions: {
        styles: [
          { color: '#1d4ed8', weight: 6, opacity: 0.3 },   // halo exterior
          { color: '#3b82f6', weight: 3, opacity: 0.95 }   // línea principal
        ],
        extendToWaypoints: false,
        missingRouteTolerance: 0
      },
      createMarker: (i: number, wp: { latLng: L.LatLngExpression }, n: number) => {
        const punto = this.agrupadosConBase[i];
        const isStart = i === 0;
        const isEnd   = i === n - 1;
        const esDestinoTour = !!punto?.esDestinoTour;

        const marker = L.marker(wp.latLng, {
          icon: this.crearIconoSvg(i, n, punto?.NombrePunto ?? '')
        });

        // Popup estilizado dark
        const reservasHtml = punto?.reservas?.length
          ? punto.reservas.map(r => {
              // Pax en este punto específico (sub-conteo para reservas multi-punto)
              const paxAqui = r.__paxEnEstePunto !== undefined ? r.__paxEnEstePunto : r.NumeroPasajeros;
              // Si hay sub-conteo distinto al total, la reserva es multi-punto
              const esMultipunto = r.__paxEnEstePunto !== undefined && r.__paxEnEstePunto !== r.NumeroPasajeros;
              const multipuntoHtml = esMultipunto
                ? `<span class="mapa-popup-multipunto" title="Total reserva: ${r.NumeroPasajeros} pax">multipunto</span>`
                : '';
              return `
                <div class="mapa-popup-reserva">
                  <span class="mapa-popup-id">#${r.Id_Reserva}</span>
                  ${multipuntoHtml}
                  <span class="mapa-popup-pax">${paxAqui} pax</span>
                </div>`;
            }).join('')
          : '<div class="mapa-popup-empty">Sin reservas</div>';

        const badgeClass = isStart ? 'badge-start' : isEnd ? 'badge-end' : 'badge-mid';
        const badgeText  = isStart ? 'INICIO' : isEnd ? (esDestinoTour ? 'TOUR' : 'FINAL') : `Parada ${i + 1}`;
        const numPaxTotal = this.totalPaxPunto(punto ?? { reservas: [] } as any);

        marker.bindPopup(`
          <div class="mapa-popup">
            <div class="mapa-popup-header">
              <span class="mapa-popup-badge ${badgeClass}">${badgeText}</span>
              ${numPaxTotal > 0 ? `<span class="mapa-popup-pax-total">${numPaxTotal} pax</span>` : ''}
            </div>
            <div class="mapa-popup-nombre">${punto?.NombrePunto ?? 'Desconocido'}</div>
            <div class="mapa-popup-reservas">${reservasHtml}</div>
          </div>
        `, {
          className: 'mapa-popup-wrapper',
          maxWidth: 280,
          minWidth: 200
        });

        // Al abrir popup, resaltar parada en el panel
        marker.on('popupopen', () => {
          this.paradaActivaIndex = i;
          this.cdr.detectChanges();
        });
        marker.on('popupclose', () => {
          this.paradaActivaIndex = null;
          this.cdr.detectChanges();
        });

        this.markers[i] = marker;
        return marker;
      }
    }).addTo(this.map);

    // Ocultar panel nativo de LRM
    const panel = document.querySelector('.leaflet-routing-container');
    if (panel) panel.remove();

    // Al encontrar ruta: actualizar stats del panel
    this.routingControl.on('routesfound', (e: any) => {
      const r = e.routes?.[0];
      if (!r) return;

      this.map.fitBounds(L.latLngBounds(r.coordinates), { padding: [32, 32] });

      const distM  = r.summary?.totalDistance ?? 0;
      const timeS  = r.summary?.totalTime ?? 0;
      this.distanciaKm = (distM / 1000).toFixed(1);
      this.tiempoMin   = Math.round(timeS / 60).toString();
      this.cdr.detectChanges();
    });

    this.routingControl.on('routingerror', () => {
      this.alerts.errorToast('Error de ruta', 'No se pudo calcular la ruta. Verifica la conexión o los puntos.');
    });
  }

  private scheduleMapInit(options?: { reset?: boolean }): void {
    if (this.initRetryHandle) {
      clearTimeout(this.initRetryHandle);
      this.initRetryHandle = null;
    }

    if (options?.reset && this.map) {
      this.map.remove();
      this.map = undefined as any;
      this.routingControl = undefined;
      this.markers = [];
    }

    const checkVisibility = () => {
      const el = this.mapContainer?.nativeElement;
      if (el && el.offsetHeight > 100 && el.offsetWidth > 100) {
        this.initRetryHandle = null;
        this.initMap();
        return;
      }
      this.initRetryHandle = setTimeout(checkVisibility, 180);
    };

    checkVisibility();
  }

  // ── Icono SVG custom por tipo de parada ─────────────────────
  private crearIconoSvg(i: number, n: number, nombre: string): L.DivIcon {
    const isStart = i === 0;
    const isEnd   = i === n - 1;

    const color  = isStart ? '#22c55e' : isEnd ? '#ef4444' : '#3b82f6';
    const shadow = isStart ? 'rgba(34,197,94,0.4)' : isEnd ? 'rgba(239,68,68,0.4)' : 'rgba(59,130,246,0.4)';
    const label  = isStart ? 'S' : isEnd ? 'F' : String(i);

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">
        <filter id="s${i}">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="${shadow}" flood-opacity="0.8"/>
        </filter>
        <path filter="url(#s${i})"
          d="M16 2C9.37 2 4 7.37 4 14c0 8.5 12 26 12 26S28 22.5 28 14C28 7.37 22.63 2 16 2z"
          fill="${color}" opacity="0.15" stroke="${color}" stroke-width="1.5"/>
        <path
          d="M16 2C9.37 2 4 7.37 4 14c0 8.5 12 26 12 26S28 22.5 28 14C28 7.37 22.63 2 16 2z"
          fill="${color}" opacity="0.9"/>
        <circle cx="16" cy="14" r="7" fill="#111" opacity="0.6"/>
        <text x="16" y="18.5" text-anchor="middle"
          font-family="system-ui, sans-serif"
          font-size="${label.length > 1 ? '8' : '10'}"
          font-weight="700" fill="white">${label}</text>
      </svg>`;

    return L.divIcon({
      html: svg,
      className: '',
      iconSize:   [32, 42],
      iconAnchor: [16, 42],
      popupAnchor: [0, -44]
    });
  }

  // ── Helpers ──────────────────────────────────────────────────
  private toNumber(v: any): number | null {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return null;
    const n = parseFloat(v.replace(',', '.').trim());
    return isNaN(n) ? null : n;
  }

  private normalizarDestinoTour(): DestinoTourMapa | null {
    const lat = this.toNumber(this.destino?.lat);
    const lng = this.toNumber(this.destino?.lng);

    if (
      lat === null || lng === null ||
      Math.abs(lat) < 1e-4 || Math.abs(lng) < 1e-4 ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180
    ) {
      return null;
    }

    return {
      lat,
      lng,
      nombre: String(this.destino?.nombre || '').trim() || 'Destino del tour'
    };
  }

  private applyTileLayer(): void {
    if (!this.map) return;
    if (this.tileLayer) this.map.removeLayer(this.tileLayer);

    const style = this.mapTheme === 'dark' ? 'dark_all' : 'light_all';
    this.tileLayer = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
      attribution: '© CARTO · OpenStreetMap',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(this.map);
  }

  private osrmRouter() {
    return {
      route: (wps: any[], done: any, ctx?: any) => {
        const max  = 50;
        const step = Math.max(1, Math.floor(wps.length / (max - 2)));
        const slice = wps.filter((_, i) => i === 0 || i === wps.length - 1 || i % step === 0);
        const coords = slice.map(wp => ({ lat: wp.latLng.lat, lng: wp.latLng.lng }));

        this.programacion.calcularRutaVisual(coords).subscribe({
          next: (route) => {
            const ll = route.coordinates.map((c: number[]) => L.latLng(c[1], c[0]));
            done.call(ctx, null, [{
              name: '',
              coordinates: ll,
              instructions: [],
              summary: {
                totalDistance: route.distance ?? 0,
                totalTime: route.duration ?? 0
              },
              inputWaypoints:  wps,
              actualWaypoints: wps
            }]);
          },
          error: (error) => done.call(ctx, error, null)
        });
      }
    };
  }
}
