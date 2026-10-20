import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { puntosService } from '../../../services/Puntos/puntos';
import { SirAlertService } from '../../../services/Alertas/alert.service';
import { OrdenarPuntosComponent } from './ordenar-puntos';

describe('Ordenar Puntos: navegación', () => {
  let fixture: ComponentFixture<OrdenarPuntosComponent>;
  let router: jasmine.SpyObj<Router>;

  beforeEach(async () => {
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));
    await TestBed.configureTestingModule({
      imports: [OrdenarPuntosComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: puntosService, useValue: {
          getRutasPuntos: () => of([]),
          getPuntosPorRuta: () => of([]),
        } },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: {
          snapshot: { queryParamMap: convertToParamMap({ ruta: '2' }) },
        } },
        { provide: SirAlertService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OrdenarPuntosComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('agrupa regreso, ruta y estados sin card y conserva los parámetros al volver', () => {
    fixture.componentInstance.isLoadingRutas.set(false);
    fixture.componentInstance.loadError.set(null);
    fixture.detectChanges();
    const back = fixture.nativeElement.querySelector('.order-back-button') as HTMLButtonElement;
    expect(back.textContent?.trim()).toBe('');
    expect(back.querySelector('svg')).not.toBeNull();
    expect(back.getAttribute('aria-label')).toBe('Volver a Puntos de encuentro');
    expect((fixture.nativeElement.querySelector('.ordenar-page') as HTMLElement).firstElementChild)
      .toBe(fixture.nativeElement.querySelector('.order-controls'));
    expect(fixture.nativeElement.querySelector('.route-selector-label')?.getAttribute('for')).toBe('ruta');
    expect(fixture.nativeElement.querySelector('.route-selector-label')?.textContent?.trim()).toBe('Ruta');
    expect(fixture.nativeElement.querySelector('.order-controls app-select')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.order-controls .route-summary')?.textContent)
      .toContain('0 puntos');
    expect(fixture.nativeElement.querySelector('.route-card')).toBeNull();
    back.click();
    expect(router.navigate).toHaveBeenCalledWith(['/Puntos/VerPuntos'], { queryParamsHandling: 'preserve' });
  });
});
