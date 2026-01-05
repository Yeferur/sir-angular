// import { Component, AfterViewInit, ViewChild, ElementRef, inject } from '@angular/core';
// import * as L from 'leaflet';
// import { puntosService, Punto } from '../../../services/Puntos/puntos';
// import { FormsModule } from '@angular/forms';
// import { CommonModule } from '@angular/common';

// @Component({
//   selector: 'app-mapa-puntos',
//   imports: [FormsModule, CommonModule],
//   templateUrl: './mapa-puntos.html',
//   styleUrl: './mapa-puntos.css'
// })
// export class MapaPuntos implements AfterViewInit {
//   @ViewChild('mapa') mapaElement!: ElementRef;
//   private puntosService = inject(puntosService);

//   map!: L.Map;
//   rutas: string[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
//   selectedRuta: string = '0'; // Ruta inicial

//   ngAfterViewInit(): void {
//     this.initMap();
//     this.loadRoute(this.selectedRuta); // Evita enviar ruta vacía
//   }

//   private initMap(): void {
//     this.map = L.map(this.mapaElement.nativeElement).setView([6.2442, -75.5812], 12); // Medellín por defecto

//     L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
//       attribution: '&copy; OpenStreetMap contributors'
//     }).addTo(this.map);
//   }

//   loadRoute(ruta: string): void {
//   if (!ruta) return;

//   this.puntosService.getPuntos(ruta).subscribe(puntos => {
//     // Limpiar marcadores anteriores (excepto el tileLayer)
//     this.map.eachLayer(layer => {
//       if ((layer as any)._url === undefined) {
//         this.map.removeLayer(layer);
//       }
//     });

//     puntos.forEach(punto => {
//       const lat = parseFloat(punto.Latitud);
//       const lng = parseFloat(punto.Longitud);

//       if (!isNaN(lat) && !isNaN(lng)) {
//         const icon = L.icon({
//           iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
//           iconSize: [25, 41],
//           iconAnchor: [12, 41],
//           popupAnchor: [1, -34],
//           shadowUrl: '' // ❌ para evitar el 404 del marker-shadow
//         });

//         L.marker([lat, lng], { icon })
//           .bindPopup(`<b>${punto.NombrePunto}</b><br>Ruta: ${punto.Ruta}`)
//           .addTo(this.map);
//       } else {
//         console.warn('Punto con coordenadas inválidas:', punto);
//       }
//     });
//   });
// }

// }