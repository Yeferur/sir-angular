import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CrearTransferComponent } from './crear-transfer/crear-transfer';
import { EditarTransferComponent } from './editar-transfer/editar-transfer';
import { TransferService } from '../../services/Transfers/transfers';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';
import { SirSelectComponent } from '../../shared/select/select';

for (const [mode, component] of [['crear', CrearTransferComponent], ['editar', EditarTransferComponent]] as const) {
  describe(`${mode} transfer: selects compartidos`, () => {
    let fixture: any;
    let c: any;
    const render = () => { fixture.changeDetectorRef.markForCheck(); fixture.detectChanges(); };
    const select = (control: string) => fixture.debugElement.queryAll(By.directive(SirSelectComponent))
      .map((el: any) => el.componentInstance as SirSelectComponent)
      .find((el: SirSelectComponent) => el.inputId.endsWith(control))!;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [component],
        providers: [provideZonelessChangeDetection(), provideRouter([]),
          { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'T-SELECT' }), queryParamMap: convertToParamMap({}), url: [] } } },
          { provide: TransferService, useValue: {
            getServicios: () => of([{ Id_Servicio: 2, Servicio: 'Hotel / Aeropuerto' }, { id: 3, Servicio: 'Aeropuerto / Hotel' }]),
            getRangos: () => of([]), getMonedas: () => of([{ Codigo: 'COP', Nombre_Moneda: 'Peso colombiano', Id_Moneda: 1 }]),
            getTransfer: () => of({ transfer: { Id_Transfer: 'T-SELECT', Id_Servicio: 2, TipoVuelo: 'Internacional', Fecha_Transfer: '2099-10-15' }, pagos: [] }),
          } },
          { provide: PermisosService, useValue: { tienePermiso: () => true, esCliente: () => false } },
          { provide: SirAlertService, useValue: { showAlert() {}, showModal() {}, warningToast() {}, errorToast() {}, closeModal() {} } },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(component as any);
      c = fixture.componentInstance;
      render(); await fixture.whenStable(); render();
    });

    it('muestra el servicio precargado y conserva las suscripciones que activan vuelos al cambiar', () => {
      if (mode === 'editar') {
        expect(select('TipoServicio').value).toBe(2);
        expect(select('TipoServicio').selectedOption?.label).toBe('Hotel / Aeropuerto');
        expect(select('TipoVuelo').selectedOption?.label).toBe('Internacional');
      }
      select('TipoServicio').open(); select('TipoServicio').choose(1); render();
      expect(c.form.get('TipoServicio').value).toBe('3');
      expect(c.showFlightFields).toBeFalse();
      expect(c.form.get('TipoVuelo').value).toBe('');
      select('TipoServicio').open(); select('TipoServicio').choose(0); render();
      expect(c.form.get('TipoServicio').value).toBe('2');
      expect(c.showFlightFields).toBeTrue();
    });

    it('mantiene required/invalid, elección de vuelo, reset y disabled de Reactive Forms', () => {
      c.form.get('TipoServicio').setValue('2'); render();
      c.form.get('TipoVuelo').reset(''); c.form.get('TipoVuelo').markAsTouched(); render();
      const field = fixture.nativeElement.querySelector(`#${mode}-transfer-TipoVuelo`);
      expect(c.form.get('TipoVuelo').invalid).toBeTrue();
      expect(field.classList.contains('errorInput')).toBeTrue();
      select('TipoVuelo').open(); select('TipoVuelo').choose(0); render();
      expect(c.form.get('TipoVuelo').value).toBe('Nacional');
      expect(c.form.get('TipoVuelo').valid).toBeTrue();
      c.form.get('TipoVuelo').disable(); render();
      expect(field.disabled).toBeTrue();
      c.form.get('TipoVuelo').enable(); c.form.get('TipoVuelo').reset(''); render();
      expect(select('TipoVuelo').selectedOption).toBeUndefined();
      expect(field.textContent).toContain('Seleccionar');
    });

    it('migra moneda con catálogo asíncrono, valor string y precarga/reset', () => {
      c.currentStep = 2;
      c.resultsMonedas = [{ Id_Moneda: 1, Codigo: 'COP', Nombre_Moneda: 'Peso' }, { Id_Moneda: 2, Codigo: 'USD', Nombre_Moneda: 'Dólar' }];
      c.form.get('Moneda').patchValue('COP'); render();
      expect(select('Moneda').selectedOption?.label).toBe('COP - Peso');
      const options = select('Moneda').options; render();
      expect(select('Moneda').options).toBe(options);
      select('Moneda').choose(1); render();
      expect(c.form.get('Moneda').value).toBe('USD');
      c.form.get('Moneda').reset('COP'); render();
      expect(select('Moneda').selectedOption?.value).toBe('COP');
      c.resultsMonedas = []; render(); expect(select('Moneda').options).toEqual([]);
    });
  });
}
