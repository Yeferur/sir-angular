import {
  Component, inject, HostListener, ChangeDetectionStrategy, ElementRef, effect, OnDestroy
} from '@angular/core';
import { SirDrawerService } from '../../services/Drawer/drawer.service';
import { ReservasDynamicComponent } from '../reserva/reserva';
import { TransferDynamicComponent } from '../transfer/transfer';
import { Mapa } from '../mapa/mapa';
import { DuplicarPanelComponent } from '../duplicar-panel/duplicar-panel';
import { AppUpdatesPanelComponent } from '../app-updates-panel/app-updates-panel';
import { TourDetailComponent } from '../tour/tour';
import { ProgramacionListadoPanelComponent } from '../programacion-listado-panel/programacion-listado-panel';
import { UsuarioDetailComponent } from '../usuario/usuario';

@Component({
  selector: 'app-sir-drawer',
  standalone: true,
  imports: [ReservasDynamicComponent, TransferDynamicComponent, TourDetailComponent, UsuarioDetailComponent, Mapa, DuplicarPanelComponent, AppUpdatesPanelComponent, ProgramacionListadoPanelComponent],
  templateUrl: './drawer-host.html',
  styleUrls: ['./drawer-host.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SirDrawerHostComponent implements OnDestroy {
  readonly drawerSvc = inject(SirDrawerService);
  readonly drawer    = this.drawerSvc.drawer;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private previousFocus: HTMLElement | null = null;
  private previousBodyOverflow = '';
  private focusFrame?: number;

  private readonly drawerFocusEffect = effect(() => {
    const current = this.drawer();
    const closing = this.drawerSvc.closing();
    if (typeof document === 'undefined') return;

    if (current && !closing) {
      if (!this.previousFocus) {
        this.previousFocus = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
        this.previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      }

      if (this.focusFrame) cancelAnimationFrame(this.focusFrame);
      this.focusFrame = requestAnimationFrame(() => {
        this.host.nativeElement
          .querySelector<HTMLElement>('.sir-drawer-panel')
          ?.focus({ preventScroll: true });
      });
      return;
    }

    if (!current) this.restorePageState();
  });

  close(): void {
    this.drawerSvc.close();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.drawer()) this.drawerSvc.close();
  }

  onPanelKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const panel = event.currentTarget as HTMLElement | null;
    if (!panel) return;

    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.offsetParent !== null);

    if (!focusable.length) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  ngOnDestroy(): void {
    this.drawerFocusEffect.destroy();
    this.restorePageState();
  }

  private restorePageState(): void {
    if (typeof document === 'undefined') return;
    if (this.focusFrame) cancelAnimationFrame(this.focusFrame);
    this.focusFrame = undefined;
    document.body.style.overflow = this.previousBodyOverflow;
    this.previousFocus?.focus({ preventScroll: true });
    this.previousFocus = null;
  }
}
