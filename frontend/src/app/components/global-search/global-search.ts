import { CommonModule } from '@angular/common';
import {
  AfterViewInit, Component, ElementRef, EventEmitter, HostListener,
  Input, Output,
  ViewChild, computed, effect, inject, signal
} from '@angular/core';
import { GlobalSearchAction, GlobalSearchResult, GlobalSearchService } from '../../services/global-search.service';
import { PermisosService } from '../../services/Permisos/permisos.service';

interface SearchShortcut {
  label: string;
  route: string;
  permission: string;
  icon: string;
}

@Component({
  selector: 'app-global-search',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './global-search.html',
  styleUrls: ['./global-search.css'],
})
export class GlobalSearchComponent implements AfterViewInit {
  private readonly search = inject(GlobalSearchService);
  private readonly permissions = inject(PermisosService);
  @Input() integrated = false;
  @Output() closeRequested = new EventEmitter<void>();

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  query    = this.search.query;
  submittedQuery = this.search.submittedQuery;
  results  = this.search.results;
  loading  = this.search.loading;
  isClosing = signal(false);
  inputFocused = signal(false);

  readonly shortcuts: SearchShortcut[] = [
    { label: 'Ver reservas', route: '/Reservas/VerReservas', permission: 'RESERVAS.LEER', icon: 'bx bx-calendar-check' },
    { label: 'Ver transfers', route: '/Transfers/VerTransfers', permission: 'TRANSFERS.LEER', icon: 'bx bx-car' },
    { label: 'Ver tours', route: '/Tours/VerTours', permission: 'TOURS.LEER', icon: 'bx bx-map-alt' },
    { label: 'Ver puntos', route: '/Puntos/VerPuntos', permission: 'PUNTOS.LEER', icon: 'bx bx-map-pin' },
  ];

  get availableShortcuts(): SearchShortcut[] {
    return this.shortcuts.filter((shortcut) => this.permissions.tienePermiso(shortcut.permission));
  }

  // ─── Computed ──────────────────────────────────────────────────
  selectedIndex = signal(0);

  groupedResults = computed(() => {
    const groups = new Map<string, GlobalSearchResult[]>();
    const labels: Record<GlobalSearchResult['type'], string> = {
      reserva: 'Reservas', transfer: 'Transfers', tour: 'Tours',
      punto: 'Puntos', servicio: 'Servicios de transfer', date: 'Consultas por fecha',
      usuario: 'Usuarios', module: 'Acciones', action: 'Acciones',
    };
    for (const item of this.results()) {
      const key = labels[item.type] || 'Resultados';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  });

  flatResults   = computed(() => this.groupedResults().flatMap(g => g.items));
  hasQuery      = computed(() => this.query().trim().length > 0);
  isCurrentQuerySubmitted = computed(() =>
    this.hasQuery() && this.submittedQuery() === this.query().trim()
  );
  showInitialState = computed(() => !this.hasQuery() && !this.loading());
  showWelcome   = computed(() => this.showInitialState() && !this.isClosing());
  showAwaitingSubmit = computed(() =>
    this.hasQuery() && !this.loading() && !this.isCurrentQuerySubmitted()
  );
  showResults = computed(() =>
    this.isCurrentQuerySubmitted() && this.flatResults().length > 0
  );
  showNoResults    = computed(() =>
    this.isCurrentQuerySubmitted() && !this.loading() && this.flatResults().length === 0
  );

  constructor() {
    effect(() => {
      const total = this.flatResults().length;
      if (total === 0) { this.selectedIndex.set(0); return; }
      if (this.selectedIndex() >= total) this.selectedIndex.set(total - 1);
    });

  }

  ngAfterViewInit(): void {
    if (!this.integrated && this.search.open()) {
      setTimeout(() => this.searchInput?.nativeElement?.focus(), 50);
    }
  }

  // ─── Input ─────────────────────────────────────────────────────
  onInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.search.updateQuery(val);
  }

  onEnterSearch(): void {
    const q = this.query().trim();
    if (!q || this.loading()) return;
    this.search.searchGlobal(q);
  }

  openShortcut(shortcut: SearchShortcut): void {
    this.search.executeAction({
      label: shortcut.label,
      kind: 'navigate',
      route: shortcut.route,
      permission: shortcut.permission,
    });
  }

  closeFromButton(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.integrated) {
      this.close();
      return;
    }
    this.isClosing.set(true);
    setTimeout(() => {
      this.close();
      this.isClosing.set(false);
    }, 140);
  }

  // ─── Navigation helpers ────────────────────────────────────────
  close(): void {
    this.isClosing.set(false);
    if (this.integrated) {
      // El layout es dueño de la geometría de la isla. Delegar el cierre evita
      // que el panel desaparezca antes de que el topbar recupere su ancho idle.
      this.closeRequested.emit();
      return;
    }
    this.search.closeSearch();
  }

  execute(result: GlobalSearchResult): void { this.search.executeAction(result); }

  executeSecondary(action: GlobalSearchAction, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.search.executeAction(action);
  }

  secondaryActions(result: GlobalSearchResult): GlobalSearchAction[] {
    return Array.isArray(result.actions) ? result.actions.slice(1) : [];
  }

  primaryActionLabel(result: GlobalSearchResult): string {
    const explicitLabel = result.actions?.[0]?.label?.trim();
    if (explicitLabel) return explicitLabel;

    const labels: Partial<Record<GlobalSearchResult['type'], string>> = {
      reserva: 'Ver detalle',
      transfer: 'Ver detalle',
      tour: 'Ver tour',
      punto: 'Ver punto',
      servicio: 'Ver transfers',
      date: 'Consultar fecha',
      usuario: 'Ver usuario',
    };
    return labels[result.type] || 'Abrir';
  }

  getFlatIndex(gi: number, ii: number): number {
    let o = 0;
    const g = this.groupedResults();
    for (let i = 0; i < gi; i++) o += g[i]?.items?.length || 0;
    return o + ii;
  }

  isSelected(i: number): boolean    { return this.selectedIndex() === i; }
  onResultHover(i: number): void    { this.selectedIndex.set(i); }

  @HostListener('document:keydown.escape', ['$event'])
  onEsc(e: Event): void {
    if (!this.search.open()) return;
    (e as KeyboardEvent).preventDefault();
    this.close();
  }

  @HostListener('document:keydown.arrowdown', ['$event'])
  onDown(e: Event): void {
    if (!this.search.open()) return;
    const t = this.flatResults().length;
    if (!t) return;
    (e as KeyboardEvent).preventDefault();
    this.selectedIndex.set((this.selectedIndex() + 1) % t);
  }

  @HostListener('document:keydown.arrowup', ['$event'])
  onUp(e: Event): void {
    if (!this.search.open()) return;
    const t = this.flatResults().length;
    if (!t) return;
    (e as KeyboardEvent).preventDefault();
    this.selectedIndex.set((this.selectedIndex() - 1 + t) % t);
  }
}
