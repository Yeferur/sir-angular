import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { SirSelectComponent } from '../shared/select/select';
import { PermisosService } from '../services/Permisos/permisos.service';
import { SirAlertService } from '../services/Alertas/alert.service';
import { CrearUsuarioComponent } from './Usuarios/crear-usuario/crear-usuario';
import { EditarUsuarioComponent } from './Usuarios/editar-usuario/editar-usuario';
import { EditarPuntoComponent } from './Puntos/editar-punto/editar-punto';
import { ComisionesComponent } from './Comisiones/comisiones';
import { ConfirmacionComponent } from './Confirmacion/confirmacion';
import { SegurosComponent } from './Seguros/seguros';
import { VerHistorialComponent } from './Historial/ver-historial';
import { VerPuntos } from './Puntos/ver-puntos/ver-puntos';
import { OrdenarPuntosComponent } from './Puntos/ordenar-puntos/ordenar-puntos';
import { TurnosComponent } from './Turnos/turnos';

async function mount(component: any) {
  spyOn(component.prototype, 'ngOnInit');
  await TestBed.configureTestingModule({
    imports: [component],
    providers: [provideZonelessChangeDetection(), provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) } } },
      { provide: PermisosService, useValue: { tienePermiso: () => true, esCliente: () => false } },
      { provide: SirAlertService, useValue: { showAlert() {}, warningToast() {}, errorToast() {}, showModal() {}, confirm: () => Promise.resolve(true) } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent<any>(component);
  const c = fixture.componentInstance;
  const render = () => { c.cdr?.markForCheck(); fixture.changeDetectorRef.markForCheck(); fixture.detectChanges(); };
  const select = (id: string) => fixture.debugElement.queryAll(By.directive(SirSelectComponent))
    .map(el => el.componentInstance as SirSelectComponent).find(el => el.inputId === id)!;
  return { fixture, c, render, select };
}

for (const [mode, component] of [['crear', CrearUsuarioComponent], ['editar', EditarUsuarioComponent]] as const) {
  describe(`${mode} usuario: migración de rol/canal`, () => {
    it('mantiene precarga numérica, validación, evento de rol y Sin asignar nativo', async () => {
      const { fixture, c, render, select } = await mount(component);
      c.isLoading.set(false); c.currentStep = 2;
      c.roles = [{ Id_Rol: 1, Nombre_Rol: 'Asesor' }, { Id_Rol: 2, Nombre_Rol: 'Otro' }];
      c.canales = [{ idCanal: '10', nombreCanal: 'Canal 10' }];
      c.form.patchValue({ Id_Rol: 1, Id_Canal: null });
      const roleChange = spyOn(c, 'onRolChange'); render();
      expect(select(`${mode}-usuario-rol`).selectedOption?.label).toBe('Asesor');
      const channel = select(`${mode}-usuario-canal`);
      expect(channel.selectedOption?.label).toBe('Sin asignar');
      channel.choose(1); render(); expect(c.form.get('Id_Canal').value).toBe('10');
      channel.choose(0); render(); expect(c.form.get('Id_Canal').value).toBe('null');
      // Native option.value = null is the string 'null'; reset remains true null.
      const nativeOption = document.createElement('option');
      (nativeOption as any).value = null;
      expect(c.form.get('Id_Canal').value).toBe(nativeOption.value);
      c.form.get('Id_Canal').reset(); render();
      expect(channel.value).toBeNull(); expect(channel.selectedOption?.label).toBe('Sin asignar');
      select(`${mode}-usuario-rol`).choose(2); render();
      expect(c.form.get('Id_Rol').value).toBe('2'); expect(roleChange).toHaveBeenCalledTimes(1);
      c.form.get('Id_Rol').reset(''); c.form.get('Id_Rol').markAsTouched(); render();
      expect(select(`${mode}-usuario-rol`).invalid).toBeTrue();
      expect(fixture.nativeElement.querySelector(`#${mode}-usuario-rol`).labels[0].textContent).toContain('Rol');
    });
  });
}

describe('Editar punto: ruta y posición dinámica', () => {
  it('conserva el valor numérico/null de ngValue y los efectos al reubicar', async () => {
    const { c, render, select } = await mount(EditarPuntoComponent);
    c.isLoading.set(false); c.currentStep = 1;
    c.rutas.set(['1', '2']); c.puntosRuta.set([{ Id_Punto: 5, NombrePunto: 'Centro', posicion: 1 }]);
    c.form.patchValue({ routeMode: 'existing', rutaExistente: '1', IdPuntoAnterior: 5 });
    const routeChange = spyOn(c, 'onRutaExistenteChange');
    const positionChange = spyOn(c, 'onPosicionChange'); render();
    const position = select('editarPuntoAnterior');
    expect(position.selectedOption?.label).toContain('Después de Centro');
    position.choose(0); render(); expect(c.form.get('IdPuntoAnterior').value).toBeNull();
    position.choose(1); render(); expect(c.form.get('IdPuntoAnterior').value).toBe(5);
    expect(positionChange).toHaveBeenCalledTimes(2);
    c.form.get('IdPuntoAnterior').patchValue('5'); render(); expect(position.selectedOption).toBeUndefined();
    c.puntosRuta.set([]); render(); expect(position.options.length).toBe(1);
    select('editarRutaExistente').choose(1); render(); expect(routeChange).toHaveBeenCalledWith('2');
    c.form.get('rutaExistente').disable(); render(); expect(select('editarRutaExistente').effectivelyDisabled).toBeTrue();
  });
});

for (const [component, id, source, model] of [
  [ComisionesComponent, 'commission-tour', 'tours', 'idTour'],
  [ConfirmacionComponent, 'trip-tour', 'toursList', 'filters'],
  [SegurosComponent, 'insurance-tour', 'tours', 'idTour'],
] as const) {
  describe(`${id}: filtro Template Forms`, () => {
    it('recibe catálogo tardío/vacío, conserva strings y no reinicia el teclado en cada render', async () => {
      const { fixture, c, render, select } = await mount(component);
      c.catalogLoading = false;
      c[source] = []; render(); await fixture.whenStable();
      expect(select(id).options.length).toBe(1);
      c[source] = [{ Id_Tour: 1, Nombre_Tour: 'Primero' }, { Id_Tour: 2, Nombre_Tour: 'Segundo' }];
      if (model === 'filters') c.filters.Id_Tour = '1'; else c[model] = '1';
      render(); await fixture.whenStable(); render();
      const field = select(id), options = field.options;
      const trigger = fixture.nativeElement.querySelector(`#${id}`);
      for (const key of ['Enter', 'ArrowDown']) {
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); render();
      }
      expect(field.options).toBe(options); expect(field.activeIndex).toBe(2);
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      render(); await fixture.whenStable(); render();
      expect(model === 'filters' ? c.filters.Id_Tour : c[model]).toBe('2');
      c[source] = []; render(); expect(field.options.length).toBe(1);
    });
  });
}

describe('Comisiones: select en modal', () => {
  it('mantiene ngModelChange, cuenta y overlay fuera del modal', async () => {
    const { fixture, c, render, select } = await mount(ComisionesComponent);
    c.catalogLoading = false; c.panel.visible = true; c.panel.mostrarDatosPago = true;
    c.panel.reportante = { Nombre_Reportante: 'Prueba', documentos: [], reservas: [] };
    c.panel.formaPago = 'NEQUI'; c.panel.cuenta = '3001234567'; render(); await fixture.whenStable(); render();
    const payment = select('payment-method'); payment.open(); render();
    expect(fixture.nativeElement.contains(document.querySelector('.sir-select-list'))).toBeFalse();
    payment.choose(3); render(); await fixture.whenStable();
    expect(c.panel.formaPago).toBe('EFECTIVO'); expect(c.panel.cuenta).toBe(''); expect(c.panel.touched).toBeTrue();
  });
});

describe('Historial y rutas: filtros por valor/evento', () => {
  it('mantiene los filtros independientes de Historial', async () => {
    const { c, render, select } = await mount(VerHistorialComponent);
    c.isInitialLoading.set(false); c.advancedFiltersVisible.set(true); render();
    select('Historial-accion').choose(1); render(); expect(c.filters().Tipo_Accion).toBe('CREATE');
    select('Historial-tabla').choose(1); render(); expect(c.filters().Tabla_Afectada).toBe('usuarios');
    select('Historial-accion').choose(0); render(); expect(c.filters().Tipo_Accion).toBe('');
    expect(c.filters().Tabla_Afectada).toBe('usuarios');
  });

  for (const [component, id] of [[VerPuntos, 'ver-puntos-ruta'], [OrdenarPuntosComponent, 'ruta']] as const) {
    it(`${id}: mantiene evento de ruta, placeholder y disabled existentes`, async () => {
      const { fixture, c, render, select } = await mount(component);
      if (component === VerPuntos) { c.isLoading.set(false); c.hasLoadedOnce.set(true); spyOn(c, 'onRouteChange'); }
      else { c.isLoadingRutas.set(false); spyOn(c, 'onRutaChangeRequest'); }
      c.rutas.set(['1', '2']); render(); await fixture.whenStable(); render();
      select(id).choose(2); render();
      expect(component === VerPuntos ? c.onRouteChange : c.onRutaChangeRequest).toHaveBeenCalledWith('2');
      c.rutas.set([]); render();
      if (component === OrdenarPuntosComponent) expect(select(id).effectivelyDisabled).toBeTrue();
      else expect(select(id).options[0].label).toBe('Todas las rutas');
    });
  }
});

describe('Turnos: canal de la semana', () => {
  it('mantiene selección/dirty del asesor y disabled por permiso', async () => {
    const { fixture, c, render, select } = await mount(TurnosComponent);
    c.loading.set(false);
    c.canales.set([{ idCanal: '1', nombreCanal: 'Uno' }, { idCanal: '2', nombreCanal: 'Dos' }]);
    c.asesores.set([{ idUsuario: 'A', nombre: 'Asesor', usuario: 'a', activo: true, turnos: [], canal: null, vacacion: null }]);
    c.selectedAdvisorId.set('A'); render(); await fixture.whenStable(); render();
    select('Turnos-canal').choose(2); render();
    expect(c.selectedAdvisor().canal.idCanal).toBe('2'); expect(c.dirtyAdvisorIds()).toEqual(['A']);
    spyOn(c, 'canUpdate').and.returnValue(false); render();
    expect(fixture.nativeElement.querySelector('#Turnos-canal').disabled).toBeTrue();
  });
});
