import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef
} from '@angular/core';

import * as L from 'leaflet';
import 'leaflet-routing-machine';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';

declare module 'leaflet' {
  namespace Routing {
    function control(options: any): any;
  }
}

@Component({
  selector: 'app-mapa',
  standalone: true,
  imports: [],
  templateUrl: './mapa.html',
  styleUrls: ['./mapa.css']
})
export class Mapa implements OnInit, OnDestroy {
  @Input() puntos: any[] = [];
  @Output() onClose = new EventEmitter<void>();

  cerrar() {
    this.onClose.emit();
  }

  constructor(private global: DynamicIslandGlobalService) { }

  private readonly apiKeyORS = '5b3ce3597851110001cf62480a1123878ce84377a396b6a142b35c3a';
  private map!: L.Map;
  private routingControl!: any;
  @ViewChild('mapaDiv') mapContainer!: ElementRef<HTMLDivElement>;

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

  private initMap(): void {
    if (!Array.isArray(this.puntos) || this.puntos.length === 0) return;

    const puntosAgrupados = new Map<string, {
      lat: number;
      lng: number;
      reservas: any[];
      NombrePunto?: string;
    }>();

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

    // ─── Verificar e insertar Estación Poblado ───────────────
  
    const baseLat = 6.212757856694648;
    const baseLng = -75.57759200491337;
    const baseKey = `${baseLat.toFixed(5)},${baseLng.toFixed(5)}`;
    const agrupadosSinBase = agrupados.filter(p =>
      `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` !== baseKey
    );
    const agrupadosConBase = [
      { lat: baseLat, lng: baseLng, NombrePunto: 'Estación Poblado', reservas: [] },
      ...agrupadosSinBase
    ];
    const waypoints = agrupadosConBase.map(p => L.latLng(p.lat, p.lng));

    if (waypoints.length < 2) {
      this.global.alert.set({
        type: 'warning',
        title: 'Coordenadas inválidas',
        message: 'No se puede mostrar el mapa porque hay menos de 2 puntos válidos con coordenadas.',
        autoCloseTime: 3000,
        autoClose: true
      });
      this.global.puntos.set(null);
      return;
    }

    const center = waypoints[0]!;
    this.map = L.map('map').setView(center, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    this.routingControl = L.Routing.control({
      waypoints,
      router: this.orsRouter(this.apiKeyORS),
      addWaypoints: false,
      routeWhileDragging: false,
      show: false,
      containerClassName: '',
      createMarker: (i: number, wp: { latLng: L.LatLngExpression; }, n: number) => {
        const punto = agrupadosConBase[i];
        const color = i === 0 ? 'green' : i === n - 1 ? 'red' : 'blue';

        const reservasHtml = punto?.reservas?.map(r =>
          `<li><strong>#${r.Id_Reserva}</strong> (${r.NumeroPasajeros} pax)</li>`
        ).join('') ?? '<li>Sin reservas</li>';

        const popupContent = `
          <div style="max-width: 260px;">
            <strong>Punto:</strong> ${punto?.NombrePunto ?? 'Desconocido'}<br>
            <strong>Reservas:</strong>
            <ul style="margin: 0; padding-left: 18px;">${reservasHtml}</ul>
          </div>
        `;

        return L.marker(wp.latLng, {
          icon: L.icon({
            iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
          })
        }).bindPopup(popupContent);
      }
    }).addTo(this.map);

    const panel = document.querySelector('.leaflet-routing-container');
    if (panel) panel.remove();

    this.routingControl.on('routesfound', (e: any) => {
      const r = e.routes?.[0];
      if (r) this.map.fitBounds(L.latLngBounds(r.coordinates));
    });
  }

  private toNumber(v: any): number | null {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return null;
    const n = parseFloat(v.replace(',', '.').trim());
    return isNaN(n) ? null : n;
  }

  private orsRouter(apiKey: string) {
    return {
      route: (wps: any[], done: any, ctx?: any) => {
        const max = 50;
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
                totalTime: feat.properties.summary?.duration ?? 0
              },
              inputWaypoints: wps,
              actualWaypoints: wps
            }]);
          })
          .catch(err => done.call(ctx, err, null));
      }
    };
  }
}
