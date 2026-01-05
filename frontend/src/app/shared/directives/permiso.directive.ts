import { Directive, Input, TemplateRef, ViewContainerRef, OnInit, OnDestroy } from '@angular/core';
import { PermisosService } from '../../services/Permisos/permisos.service';
import { Subject, takeUntil } from 'rxjs';

/**
 * Directiva estructural para mostrar/ocultar elementos según permisos
 * 
 * Uso:
 * <div *appPermiso="'TOURS.CREAR'">Solo usuarios con permiso TOURS.CREAR verán esto</div>
 * <button *appPermiso="['RESERVAS.ACTUALIZAR', 'RESERVAS.ELIMINAR']; requireAll: true">
 *   Solo si tiene ambos permisos
 * </button>
 */
@Directive({
  selector: '[appPermiso]',
  standalone: true
})
export class PermisoDirective implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private permisos: string | string[] = [];
  private requireAll = false;
  private hasView = false;

  constructor(
    private templateRef: TemplateRef<any>,
    private viewContainer: ViewContainerRef,
    private permisosService: PermisosService
  ) {}

  @Input() set appPermiso(permisos: string | string[]) {
    this.permisos = permisos;
    this.updateView();
  }

  @Input() set appPermisoRequireAll(requireAll: boolean) {
    this.requireAll = requireAll;
    this.updateView();
  }

  ngOnInit() {
    // Suscribirse a cambios en permisos
    this.permisosService.permisos$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.updateView();
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private updateView() {
    const tienePermiso = this.checkPermission();

    if (tienePermiso && !this.hasView) {
      this.viewContainer.createEmbeddedView(this.templateRef);
      this.hasView = true;
    } else if (!tienePermiso && this.hasView) {
      this.viewContainer.clear();
      this.hasView = false;
    }
  }

  private checkPermission(): boolean {
    if (!this.permisos) {
      return true; // Si no se especifica permiso, mostrar por defecto
    }

    if (Array.isArray(this.permisos)) {
      return this.requireAll
        ? this.permisosService.tieneTodosPermisos(this.permisos)
        : this.permisosService.tieneAlgunPermiso(this.permisos);
    }

    return this.permisosService.tienePermiso(this.permisos);
  }
}
