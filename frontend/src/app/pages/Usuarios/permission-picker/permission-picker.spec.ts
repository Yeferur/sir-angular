import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PermissionPickerComponent } from './permission-picker';
import { PermisoCompleto } from '../../../services/Permisos/permisos.service';
import { CrearUsuarioComponent } from '../crear-usuario/crear-usuario';
import { EditarUsuarioComponent } from '../editar-usuario/editar-usuario';
import { groupPermissions } from './permission-groups';

const permission = (id: number, description: string, module: string): PermisoCompleto => ({
  Id_Permiso: id, Codigo_Permiso: `${module}.LEER`, Accion: 'LEER', Descripcion: description,
  Id_Modulo: id, Codigo_Modulo: module, Nombre_Modulo: module,
});

describe('PermissionPickerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PermissionPickerComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
  });

  it('muestra nombres completos, cambia de módulo y conserva la selección', async () => {
    const fixture = TestBed.createComponent(PermissionPickerComponent);
    const component = fixture.componentInstance;
    const name = 'Consultar reservas del módulo de análisis comercial';
    component.groups = [
      { key: 'MERCADEO', label: 'Mercadeo', permisos: [permission(1, name, 'MERCADEO')] },
      { key: 'INICIO', label: 'Inicio', permisos: [permission(2, 'Ver inicio', 'INICIO')] },
    ];
    component.selectedIds = [1];
    component.hasRole = true;
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain(name);
    expect(host.querySelectorAll('.permission-group').length).toBe(1);
    expect(host.querySelectorAll('.permission-module').length).toBe(2);
    expect(host.querySelector('.permission-module')?.textContent).toContain('1/1');
    expect(host.querySelector('.permission-option--selected')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain('1 seleccionado');
    host.querySelectorAll<HTMLButtonElement>('.permission-module')[1].click();
    fixture.detectChanges();
    expect(host.querySelector('.permission-group')?.getAttribute('aria-label')).toBe('Inicio');
    expect(host.querySelectorAll('.permission-option').length).toBe(1);
    expect(host.querySelector('.permission-module--active')?.textContent).toContain('Inicio');
    const search = host.querySelector<HTMLInputElement>('#permission-search')!;
    search.value = 'comercial';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.querySelectorAll('.permission-group').length).toBe(1);
    expect(host.textContent).toContain(name);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.querySelector('.permission-group')?.getAttribute('aria-label')).toBe('Inicio');
  });

  it('busca por módulo y código técnico, y emite selección y deselección inmediata', async () => {
    const fixture = TestBed.createComponent(PermissionPickerComponent);
    const component = fixture.componentInstance;
    component.groups = [
      { key: 'MERCADEO', label: 'Mercadeo', permisos: [permission(1, 'Análisis comercial', 'MERCADEO')] },
      { key: 'USUARIOS', label: 'Usuarios', permisos: [permission(2, 'Administrar usuarios', 'USUARIOS')] },
    ];
    component.hasRole = true;
    component.permissionToggle.subscribe(id => {
      component.selectedIds = component.selectedIds.includes(id)
        ? component.selectedIds.filter(value => value !== id)
        : [...component.selectedIds, id];
    });
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const option = host.querySelector<HTMLButtonElement>('.permission-option')!;
    option.click();
    fixture.detectChanges();
    expect(option.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.permission-module')?.textContent).toContain('1/1');
    option.click();
    fixture.detectChanges();
    expect(option.getAttribute('aria-pressed')).toBe('false');

    const search = host.querySelector<HTMLInputElement>('#permission-search')!;
    search.value = 'USUARIOS.LEER';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.querySelector('.permission-group')?.getAttribute('aria-label')).toBe('Usuarios');
    expect(host.querySelectorAll('.permission-option').length).toBe(1);
    search.value = 'Mercadeo';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.querySelector('.permission-group')?.getAttribute('aria-label')).toBe('Mercadeo');
    expect(host.querySelectorAll('.permission-option').length).toBe(1);
  });

  it('usa navegación compacta en móvil/tablet y deja espacio para la barra fija', () => {
    const fixture = TestBed.createComponent(PermissionPickerComponent);
    fixture.componentInstance.groups = [
      { key: 'MERCADEO', label: 'Mercadeo', permisos: [permission(1, 'Consultar información comercial sin abreviar', 'MERCADEO')] },
    ];
    fixture.componentInstance.hasRole = true;
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const nav = host.querySelector<HTMLElement>('.permission-module-nav')!;
    const select = host.querySelector<HTMLElement>('.permission-module-select')!;
    if (window.innerWidth <= 850) {
      expect(getComputedStyle(nav).display).toBe('none');
      expect(getComputedStyle(select).display).not.toBe('none');
    } else {
      expect(getComputedStyle(nav).display).not.toBe('none');
      expect(getComputedStyle(select).display).toBe('none');
    }
    const shell = document.createElement('div');
    shell.className = 'wizard-shell';
    const footer = document.createElement('div');
    footer.className = 'wizard-nav';
    footer.innerHTML = '<div class="wizard-nav-row">Anterior <span>Usuario</span> Continuar</div>';
    document.body.append(shell, footer);
    try {
      const reserved = Number.parseFloat(getComputedStyle(shell).paddingBottom);
      expect(reserved).withContext('espacio inferior del wizard').toBeGreaterThan(footer.getBoundingClientRect().height);
      expect(host.querySelector('.permission-copy strong')?.textContent).toBe('Consultar información comercial sin abreviar');
    } finally {
      shell.remove();
      footer.remove();
    }
  });

  it('Crear y Editar Usuario comparten el mismo selector', () => {
    const createImports = (CrearUsuarioComponent as any).ɵcmp.dependencies();
    const editImports = (EditarUsuarioComponent as any).ɵcmp.dependencies();
    expect(createImports).toContain(PermissionPickerComponent);
    expect(editImports).toContain(PermissionPickerComponent);
  });

  it('deriva los grupos del catálogo real y ordena acciones de cada módulo', () => {
    const groups = groupPermissions([
      { ...permission(3, 'Crear reserva', 'RESERVAS'), Accion: 'CREAR' },
      permission(1, 'Ver Mercadeo', 'MERCADEO'),
      permission(2, 'Ver reservas', 'RESERVAS'),
    ]);
    expect(groups.map(group => group.label)).toEqual(['Reservas', 'Mercadeo']);
    expect(groups[0].permisos.map(item => item.Descripcion)).toEqual(['Ver reservas', 'Crear reserva']);
  });
});
