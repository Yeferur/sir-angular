import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  standalone: true,
  template: '<p class="sr-only" role="status">Abriendo Mercadeo…</p>',
})
export class MercadeoLegacyRedirectComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  ngOnInit(): void {
    const params = { ...this.route.snapshot.queryParams };
    const isEntitiesRoute = this.route.snapshot.data['mercadeoLegacyTab'] === 'entidades';
    if (isEntitiesRoute) {
      params['vista'] = 'entidades';
    } else {
      params['vista'] = 'origen';
      const rawType = String(params['tipo'] || params['tipoOperacion'] || params['modo'] || '').trim().toLocaleUpperCase('es-CO');
      if (['TRANSFER', 'TRANSFERS'].includes(rawType)) params['tipo'] = 'TRANSFER';
      else if (['RESERVA', 'RESERVAS'].includes(rawType)) params['tipo'] = 'RESERVA';
      else params['tipo'] = 'TODOS';
    }
    void this.router.navigate(['/Mercadeo'], { queryParams: params, replaceUrl: true });
  }
}
