import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, HostListener, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { DynamicIslandGlobalService, GlobalSearchResult } from '../../services/DynamicNavbar/global';

@Component({
  selector: 'app-global-search',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './global-search.html',
  styleUrls: ['./global-search.css'],
})
export class GlobalSearchComponent implements AfterViewInit {
  private readonly navbar = inject(DynamicIslandGlobalService);

  @ViewChild('searchInput') private searchInput?: ElementRef<HTMLInputElement>;

  query = this.navbar.globalSearchQuery;
  results = this.navbar.globalSearchResults;
  loading = this.navbar.globalSearchLoading;

  selectedIndex = signal(0);

  groupedResults = computed(() => {
    const groups = new Map<string, GlobalSearchResult[]>();
    const labels: Record<GlobalSearchResult['type'], string> = {
      reserva: 'Reservas',
      transfer: 'Transfers',
      tour: 'Tours',
      punto: 'Puntos',
      usuario: 'Usuarios',
      module: 'Acciones',
      action: 'Acciones',
    };

    for (const item of this.results()) {
      const key = labels[item.type] || 'Resultados';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }

    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
  });

  flatResults = computed(() => this.groupedResults().flatMap((group) => group.items));

  constructor() {
    effect(() => {
      const total = this.flatResults().length;
      if (total === 0) {
        this.selectedIndex.set(0);
        return;
      }

      const current = this.selectedIndex();
      if (current >= total) {
        this.selectedIndex.set(total - 1);
      }
    });

    effect(() => {
      if (!this.navbar.globalSearchOpen()) return;
      setTimeout(() => this.searchInput?.nativeElement?.focus(), 0);
    });
  }

  ngAfterViewInit(): void {
    if (this.navbar.globalSearchOpen()) {
      setTimeout(() => this.searchInput?.nativeElement?.focus(), 0);
    }
  }

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement)?.value ?? '';
    this.selectedIndex.set(0);
    this.navbar.searchGlobal(value);
  }

  close(): void {
    this.navbar.closeGlobalSearch();
  }

  execute(result: GlobalSearchResult): void {
    this.navbar.executeSearchAction(result);
  }

  executeAction(event: Event, action: any): void {
    event.stopPropagation();
    this.navbar.executeSearchAction(action);
  }

  getFlatIndex(groupIndex: number, itemIndex: number): number {
    let offset = 0;
    const groups = this.groupedResults();
    for (let i = 0; i < groupIndex; i++) {
      offset += groups[i]?.items?.length || 0;
    }
    return offset + itemIndex;
  }

  isSelected(index: number): boolean {
    return this.selectedIndex() === index;
  }

  onResultHover(index: number): void {
    this.selectedIndex.set(index);
  }

  @HostListener('document:keydown.escape', ['$event'])
  handleEscape(event: Event): void {
    if (!this.navbar.globalSearchOpen()) return;
    const keyboardEvent = event as KeyboardEvent;
    keyboardEvent.preventDefault();
    this.close();
  }

  @HostListener('document:keydown.arrowdown', ['$event'])
  handleArrowDown(event: Event): void {
    if (!this.navbar.globalSearchOpen()) return;
    const total = this.flatResults().length;
    if (!total) return;
    const keyboardEvent = event as KeyboardEvent;
    keyboardEvent.preventDefault();
    this.selectedIndex.set((this.selectedIndex() + 1) % total);
  }

  @HostListener('document:keydown.arrowup', ['$event'])
  handleArrowUp(event: Event): void {
    if (!this.navbar.globalSearchOpen()) return;
    const total = this.flatResults().length;
    if (!total) return;
    const keyboardEvent = event as KeyboardEvent;
    keyboardEvent.preventDefault();
    this.selectedIndex.set((this.selectedIndex() - 1 + total) % total);
  }

  @HostListener('document:keydown.enter', ['$event'])
  handleEnter(event: Event): void {
    if (!this.navbar.globalSearchOpen()) return;
    const keyboardEvent = event as KeyboardEvent;
    const target = keyboardEvent.target as HTMLElement | null;
    const tagName = target?.tagName?.toLowerCase() || '';
    if (tagName === 'button' || tagName === 'a' || target?.closest('button')) return;

    const items = this.flatResults();
    if (!items.length) return;

    keyboardEvent.preventDefault();
    const selected = items[this.selectedIndex()] || items[0];
    if (selected) {
      this.execute(selected);
    }
  }
}
