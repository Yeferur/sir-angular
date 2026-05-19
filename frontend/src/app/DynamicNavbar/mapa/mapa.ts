import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  ChangeDetectorRef
} from '@angular/core';

import * as L from 'leaflet';
import 'leaflet-routing-machine';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';
import { CommonModule } from '@angular/common';

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
  @Output() onClose = new EventEmitter<void>();
  @ViewChild('mapaDiv') mapContainer!: ElementRef<HTMLDivElement>;

  // ── Estado del panel lateral ─────────────────────────────────
  agrupadosConBase: PuntoAgrupado[] = [];
  paradaActivaIndex: number | null = null;
  distanciaKm: string = '—';
  tiempoMin: string = '—';
  totalPax: number = 0;

  private map!: L.Map;
  private routingControl!: any;
  private markers: L.Marker[] = [];
  private readonly apiKeyORS = '5b3ce3597851110001cf62480a1123878ce84377a396b6a142b35c3a';

  constructor(
    private global: DynamicIslandGlobalService,
    private cdr: ChangeDetectorRef
  ) {}

  cerrar() {
    this.onClose.emit();
  }

  ngOnInit(): void {
    const checkVisibility = () => {
      const el = this.mapContainer?.nativeElement;
      if (el && el.offsetHeight > 100 && el.offsetWidth > 100) {
        this.initMap();
      } else {
        setTimeout(checkVisibility, 400);
      }
    };
    checkVisibility();
  }

  ngOnDestroy(): void {
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
    return punto.reservas.reduce((sum, r) => sum + (Number(r.NumeroPasajeros) || 0), 0);
  }

  // ── Init del mapa ────────────────────────────────────────────
  private initMap(): void {
    if (!Array.isArray(this.puntos) || this.puntos.length === 0) return;

    // ── Agrupar por coordenada ─────────────────────────────────
    const puntosAgrupados = new Map<string, PuntoAgrupado>();

    for (const r of this.puntos) {
      const lat = this.toNumber(r.lat ?? r.Latitud);
      const lng = this.toNumber(r.lng ?? r.Longitud ?? r.Lng);

      if (
        lat === null || lng === null ||
        Math.abs(lat) < 1e-4 || Math.abs(lng) < 1e-4 ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) continue;

      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      if (!puntosAgrupados.has(key)) {
        puntosAgrupados.set(key, {
          lat,
          lng,
          NombrePunto: r.NombrePunto ?? `Punto ${r.Id_Punto ?? ''}`,
          reservas: []
        });
      }
      puntosAgrupados.get(key)!.reservas.push(r);
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
      { lat: baseLat, lng: baseLng, NombrePunto: 'Estación Poblado', reservas: [] },
      ...agrupadosSinBase
    ];

    // Calcular total de pasajeros para el panel
    this.totalPax = this.agrupadosConBase.reduce(
      (sum, p) => sum + this.totalPaxPunto(p), 0
    );

    const waypoints = this.agrupadosConBase.map(p => L.latLng(p.lat, p.lng));

    if (waypoints.length < 2) {
      this.global.showAlert({
        type: 'warning',
        title: 'Coordenadas inválidas',
        message: 'No se puede mostrar el mapa porque hay menos de 2 puntos válidos con coordenadas.',
        autoCloseTime: 3000,
        autoClose: true
      });
      this.global.puntos.set(null);
      return;
    }

    // ── Crear mapa con tile oscuro ─────────────────────────────
    const center = waypoints[0]!;
    this.map = L.map(this.mapContainer.nativeElement, {
      zoomControl: false  // lo añadimos nosotros con posición custom
    }).setView(center, 13);

    // Tile oscuro de CartoDB (sin API key, gratuito)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(this.map);

    // Zoom control en posición bottom-left
    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

    // ── Routing ───────────────────────────────────────────────
    const Routing = (L as any).Routing || (window as any).L?.Routing;

    if (!Routing) {
      this.global.showAlert({
        type: 'error',
        title: 'Error de mapa',
        message: 'No se pudo cargar el módulo de rutas (Leaflet Routing Machine).',
        autoCloseTime: 5000,
        autoClose: true
      });
      return;
    }

    this.routingControl = Routing.control({
      waypoints,
      router: this.orsRouter(this.apiKeyORS),
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

        const marker = L.marker(wp.latLng, {
          icon: this.crearIconoSvg(i, n, punto?.NombrePunto ?? '')
        });

        // Popup estilizado dark
        const reservasHtml = punto?.reservas?.length
          ? punto.reservas.map(r => `
              <div class="mapa-popup-reserva">
                <span class="mapa-popup-id">#${r.Id_Reserva}</span>
                <span class="mapa-popup-pax">${r.NumeroPasajeros} pax</span>
              </div>`).join('')
          : '<div class="mapa-popup-empty">Sin reservas</div>';

        const badgeClass = isStart ? 'badge-start' : isEnd ? 'badge-end' : 'badge-mid';
        const badgeText  = isStart ? 'INICIO' : isEnd ? 'FINAL' : `Parada ${i + 1}`;
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
      this.global.showAlert({
        type: 'error',
        title: 'Error de ruta',
        message: 'No se pudo calcular la ruta. Verifica la conexión o los puntos.',
        autoCloseTime: 4000,
        autoClose: true
      });
    });
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

  private orsRouter(apiKey: string) {
    return {
      route: (wps: any[], done: any, ctx?: any) => {
        const max  = 50;
        const step = Math.max(1, Math.floor(wps.length / (max - 2)));
        const slice = wps.filter((_, i) => i === 0 || i === wps.length - 1 || i % step === 0);
        const coords = slice.map(wp => [wp.latLng.lng, wp.latLng.lat]);

        fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
          method: 'POST',
          headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ coordinates: coords, instructions: false })
        })
          .then(r => r.ok ? r.json() : Promise.reject(new Error(`ORS ${r.status}`)))
          .then(json => {
            const feat = json.features?.[0];
            if (!feat) return done.call(ctx, new Error('Ruta no encontrada'));

            const ll = feat.geometry.coordinates.map((c: number[]) => L.latLng(c[1], c[0]));
            done.call(ctx, null, [{
              name: '',
              coordinates: ll,
              instructions: [],
              summary: {
                totalDistance: feat.properties.summary?.distance ?? 0,
                totalTime:     feat.properties.summary?.duration ?? 0
              },
              inputWaypoints:  wps,
              actualWaypoints: wps
            }]);
          })
          .catch(err => done.call(ctx, err, null));
      }
    };
  }
}