import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  Output,
  EventEmitter
} from '@angular/core';

import * as L from 'leaflet';
import 'leaflet-routing-machine';

declare module 'leaflet' {
  namespace Routing {
    function control(options: any): any;
  }
}

@Component({
  selector: 'app-bus-mapa',
  standalone: true,
  imports: [],
  templateUrl: './bus-mapa.html',
  styleUrls: ['./bus-mapa.css']
})
export class BusMapa implements OnInit, OnDestroy {
  /** Lista de puntos con cualquier convención de nombre */
  @Input() puntos: any[] = [];
  /** Devuelve los puntos que realmente son inválidos */
  @Output() puntosNoValidos = new EventEmitter<any[]>();

  /** 🔐 Coloca tu API‑Key de OpenRouteService aquí */
  private readonly apiKeyORS = '5b3ce3597851110001cf62480a1123878ce84377a396b6a142b35c3a';

  private map!: L.Map;
  private routingControl!: any;

  // ────────────────────────────────────────────── Ciclo de vida ──
  ngOnInit(): void {
    setTimeout(() => this.initMap(), 0);
  }
  ngOnDestroy(): void {
    this.map?.remove();
  }

  // ────────────────────────────────────── Init + validación ──
  private initMap(): void {
    if (!Array.isArray(this.puntos) || this.puntos.length === 0) {
      this.puntosNoValidos.emit([]);
      return;
    }

    const valid: L.LatLng[] = [];
    const invalid: any[] = [];

    for (const p of this.puntos) {
      const rawLat = p.lat ?? p.Latitud ?? p.latitude ?? p.Latitude;
      const rawLng = p.lng ?? p.Longitud ?? p.longitude ?? p.Longitude ?? p.Lng;

      const lat = this.toNumber(rawLat);
      const lng = this.toNumber(rawLng);

      const ok =
        lat !== null &&
        lng !== null &&
        Math.abs(lat) > 1e-4 &&
        Math.abs(lng) > 1e-4 &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180;

      if (ok) valid.push(L.latLng(lat, lng));
      else invalid.push({ ...p, lat: rawLat, lng: rawLng });
    }

    this.puntosNoValidos.emit(invalid);

    const center = valid[0] ?? L.latLng(4.6, -74.0);
    this.map = L.map('map').setView(center, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    if (valid.length < 2) {
      console.warn('Necesitas al menos dos puntos válidos');
      return;
    }

    this.routingControl = L.Routing.control({
      waypoints: valid,
      router: this.orsRouter(this.apiKeyORS),
      addWaypoints: false,
      routeWhileDragging: false,
      show: false,
      createMarker: (i: number, wp: { latLng: L.LatLngExpression; }, n: number) => {
        const color = i === 0 ? 'green' : i === n - 1 ? 'red' : 'blue';
        return L.marker(wp.latLng, {
          icon: L.icon({
            iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
          })
        });
      }
    }).addTo(this.map);

    this.routingControl.on('routesfound', (e: any) => {
      const r = e.routes?.[0];
      if (r) this.map.fitBounds(L.latLngBounds(r.coordinates));
    });
  }

  // ──────────────────────────── Conversión segura a número ──
  private toNumber(v: any): number | null {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return null;
    const n = parseFloat(v.replace(',', '.').trim());
    return isNaN(n) ? null : n;
  }

  // ───────────────────────── Adaptador OpenRouteService ──
  private orsRouter(apiKey: string) {
    return {
      route: (wps: any[], done: any, ctx?: any) => {
        /** ORS → máx 50 puntos */
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
              actualWaypoints: wps,
              
            }]);
          })
          .catch(err => done.call(ctx, err, null));
      }
    };
  }
}
