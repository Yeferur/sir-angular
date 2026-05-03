import { CommonModule } from '@angular/common';
import { Component, ViewChild, inject, OnInit, AfterViewInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, finalize, catchError, of } from 'rxjs';
import { FlatpickrInputDirective } from '../../shared/directives/flatpickr-input';
import type { Options as FlatpickrOptions } from 'flatpickr/dist/types/options';

import { DashboardService } from '../../services/dashboard.service';
import { DynamicIslandGlobalService } from '../../services/DynamicNavbar/global';

import {
  NgApexchartsModule,
  ChartComponent,
  ApexAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexTitleSubtitle,
  ApexStroke,
  ApexFill,
  ApexTooltip,
  ApexDataLabels,
  ApexYAxis,
  ApexGrid,
  ApexLegend,
  ApexPlotOptions
} from 'ng-apexcharts';

export type ChartOptions = {
  series: ApexAxisChartSeries | any;
  chart: ApexChart;
  xaxis: ApexXAxis;
  title?: ApexTitleSubtitle;
  stroke: ApexStroke;
  fill: ApexFill;
  tooltip: ApexTooltip;
  dataLabels: ApexDataLabels;
  yaxis: ApexYAxis;
  grid: ApexGrid;
  legend?: ApexLegend;
  plotOptions?: ApexPlotOptions;
  labels?: string[];
  colors?: string[];
};

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, NgApexchartsModule, FormsModule, FlatpickrInputDirective],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.css']
})
export class DashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  private dashboardService = inject(DashboardService);
  private navbar = inject(DynamicIslandGlobalService);
  private cdr = inject(ChangeDetectorRef);

  // STATS
  totalReservas = 0;
  totalPasajeros = 0;
  totalIngresos = 0;
  totalTransfers = 0;

  // FILTERS
  startDate = '';
  endDate = '';

  // CHART VIEWCHILD
  @ViewChild('chartIncome') chartIncome?: ChartComponent;
  @ViewChild('chartPassengers') chartPassengers?: ChartComponent;
  @ViewChild('chartOccupancy') chartOccupancy?: ChartComponent;
  @ViewChild('startDateFp') startDateFp?: FlatpickrInputDirective;
  @ViewChild('endDateFp') endDateFp?: FlatpickrInputDirective;

  // OPTIONS
  public incomeChartOptions: Partial<ChartOptions> | any;
  public passengerChartOptions: Partial<ChartOptions> | any;
  public occupancyChartOptions: Partial<ChartOptions> | any;

  // FLAGS / CACHE
  isInitialLoading = true;
  isRefreshing = false;
  isLoading = true;
  hasIncomeData = false;
  hasPassengerData = false;
  hasOccupancyData = false;
  private viewReady = false;
  private lastResponse: any = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private dashboardRequestId = 0;

  fpOptionsFecha: Partial<FlatpickrOptions> = {
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'd/m/Y',
    allowInput: false,
    disableMobile: true,
    monthSelectorType: 'dropdown' as FlatpickrOptions['monthSelectorType'],
    altInputClass: 'form-input flatpickr-input flatpickr-alt',

    onReady: (_sel, _str, inst: any) => {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;

      const cal: HTMLElement = inst?.calendarContainer;
      if (!cal) return;

      cal.classList.add('sir-flatpickr');

      const clampDay = (y: number, m: number, d: number) => {
        const last = new Date(y, m + 1, 0).getDate();
        return Math.min(Math.max(d, 1), last);
      };

      let yearSelect: HTMLSelectElement | null = null;

      const ensureYearSelect = () => {
        const monthWrap = cal.querySelector('.flatpickr-month') as HTMLElement | null;
        if (!monthWrap) return null;

        const numWrap = monthWrap.querySelector('.numInputWrapper') as HTMLElement | null;
        if (numWrap) {
          try { numWrap.remove(); } catch { /* ignore */ }
        }

        const curMonth = monthWrap.querySelector('.flatpickr-current-month') as HTMLElement | null;
        const container = curMonth ?? monthWrap;

        yearSelect = container.querySelector('.sir-year-select') as HTMLSelectElement | null;
        if (yearSelect) return yearSelect;

        const oldDiv = monthWrap.querySelector('.sir-year-div') as HTMLElement | null;
        if (oldDiv) {
          try { oldDiv.remove(); } catch { /* ignore */ }
        }

        yearSelect = document.createElement('select');
        yearSelect.className = 'sir-year-select';
        yearSelect.setAttribute('aria-label', 'Seleccionar año');

        try { container.appendChild(yearSelect); } catch { monthWrap.appendChild(yearSelect); }
        return yearSelect;
      };

      const buildYears = (centerYear: number) => {
        const sel = ensureYearSelect();
        if (!sel) return;

        const start = centerYear - 20;
        const end = centerYear + 20;

        sel.innerHTML = '';
        for (let y = end; y >= start; y--) {
          const opt = document.createElement('option');
          opt.value = String(y);
          opt.textContent = String(y);
          sel.appendChild(opt);
        }
        sel.value = String(centerYear);
      };

      const syncSelectValue = () => {
        const sel = ensureYearSelect();
        if (!sel) return;

        const y = inst.currentYear ?? new Date().getFullYear();
        const exists = !!sel.querySelector(`option[value="${y}"]`);
        if (!exists) buildYears(y);
        sel.value = String(y);
      };

      const getSafeDay = () => {
        const d: Date | undefined = inst.selectedDates?.[0];
        return d ? d.getDate() : 1;
      };

      const onChange = () => {
        const sel = ensureYearSelect();
        if (!sel) return;

        const y = Number(sel.value);
        const m = typeof inst.currentMonth === 'number' ? inst.currentMonth : new Date().getMonth();
        const day = clampDay(y, m, getSafeDay());

        const newDate = new Date(y, m, day);

        if (typeof inst.jumpToDate === 'function') inst.jumpToDate(newDate);

        if (inst.selectedDates?.length) {
          inst.setDate(newDate, true);
        }
      };

      buildYears(inst.currentYear ?? new Date().getFullYear());
      syncSelectValue();

      const sel0 = ensureYearSelect();
      sel0?.addEventListener('change', onChange);

      const wrap = (key: 'onMonthChange' | 'onYearChange', fn: any) => {
        const prev = inst.config[key];
        const arr = Array.isArray(prev) ? prev : prev ? [prev] : [];
        inst.config[key] = [...arr, fn];
      };

      wrap('onMonthChange', () => syncSelectValue());
      wrap('onYearChange', () => syncSelectValue());

      const prevOnDestroy = inst.config.onDestroy;
      const destroyArr = Array.isArray(prevOnDestroy) ? prevOnDestroy : prevOnDestroy ? [prevOnDestroy] : [];
      inst.config.onDestroy = [
        ...destroyArr,
        () => sel0?.removeEventListener('change', onChange)
      ];
    }
  };

  ngOnInit() {
    const tomorrow = this.getTomorrowDateValue();
    this.startDate = tomorrow;
    this.endDate = tomorrow;
    this.initCharts();
    this.loadData(true);
  }

  ngAfterViewInit() {
    this.viewReady = true;
    this.syncDatePickers();

    // Si la data llegó antes del view, la aplicamos acá
    if (this.lastResponse) {
      this.applyChartData(this.lastResponse);
      this.forceChartsReflow();
    }
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  private initCharts() {
    this.incomeChartOptions = {
      series: [{ name: 'Ingresos', data: [] }],
      chart: {
        id: 'income-chart',
        type: 'area',
        height: 350,
        toolbar: { show: false },
        fontFamily: 'Inter, sans-serif',
        background: 'transparent',
        animations: { enabled: true },
        redrawOnParentResize: true,
        redrawOnWindowResize: true
      },
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 3 },
      xaxis: {
        categories: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
        labels: { style: { colors: '#a3a3a3' } },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      yaxis: {
        labels: {
          style: { colors: '#a3a3a3' },
          formatter: (value: number) =>
            new Intl.NumberFormat('es-CO', {
              style: 'currency',
              currency: 'COP',
              maximumSignificantDigits: 3
            }).format(value)
        }
      },
      fill: {
        type: 'gradient',
        gradient: { shadeIntensity: 1, opacityFrom: 0.7, opacityTo: 0.1, stops: [0, 90, 100] }
      },
      colors: ['#ffd700'],
      grid: {
        borderColor: '#333',
        strokeDashArray: 4,
        yaxis: { lines: { show: true } },
        xaxis: { lines: { show: false } }
      },
      tooltip: { theme: 'dark' }
    };

    this.passengerChartOptions = {
      series: [],
      chart: {
        id: 'passengers-chart',
        type: 'donut',
        height: 350,
        fontFamily: 'Inter, sans-serif',
        background: 'transparent',
        animations: { enabled: true },
        redrawOnParentResize: true,
        redrawOnWindowResize: true
      },
      labels: [],
      colors: ['#00E396', '#FEB019', '#FF4560'],
      legend: { position: 'bottom', labels: { colors: '#fff' } },
      dataLabels: { enabled: true },
      plotOptions: {
        pie: {
          donut: {
            size: '65%',
            labels: {
              show: true,
              total: { show: true, label: 'Total', color: '#fff', fontSize: '20px', fontWeight: 600 },
              value: { color: '#fff' }
            }
          }
        }
      },
      stroke: { show: false },
      tooltip: { theme: 'dark' }
    };

    this.occupancyChartOptions = {
      series: [{ name: 'Pasajeros', data: [] }],
      chart: {
        id: 'occupancy-chart',
        type: 'bar',
        height: 350,
        toolbar: { show: false },
        fontFamily: 'Inter, sans-serif',
        background: 'transparent',
        animations: { enabled: true },
        redrawOnParentResize: true,
        redrawOnWindowResize: true
      },
      plotOptions: {
        bar: { horizontal: true, borderRadius: 4, barHeight: '70%', distributed: true }
      },
      colors: ['#33b2df', '#546E7A', '#d4526e', '#13d8aa', '#A5978B', '#2b908f', '#f9a3a4', '#90ee7e', '#f48024', '#69d2e7'],
      dataLabels: { enabled: true, textAnchor: 'start', style: { colors: ['#fff'] }, offsetX: 0 },
      xaxis: { categories: [], labels: { style: { colors: '#a3a3a3' } } },
      yaxis: { labels: { style: { colors: '#fff' } } },
      grid: {
        borderColor: '#333',
        strokeDashArray: 4,
        xaxis: { lines: { show: true } },
        yaxis: { lines: { show: false } }
      },
      legend: { show: false },
      tooltip: { theme: 'dark' }
    };
  }

  private toDateInputValue(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getTomorrowDateValue(): string {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return this.toDateInputValue(tomorrow);
  }

  private syncDatePickers(): void {
    this.startDateFp?.instance?.setDate(this.startDate, false);
    this.endDateFp?.instance?.setDate(this.endDate, false);
  }

  private applyChartData(res: any) {
    // Income
    const incomeData = Array.isArray(res?.income) ? res.income.map((v: any) => Number(v) || 0) : [];
    this.hasIncomeData = incomeData.some((value: number) => value > 0);
    const incomeSeries = [{ name: 'Ingresos', data: incomeData.length ? incomeData : [0] }];
    this.incomeChartOptions = {
      ...this.incomeChartOptions,
      series: incomeSeries
    };

    if (this.chartIncome) {
      this.chartIncome.updateOptions({ series: incomeSeries }, true, true);
      this.chartIncome.updateSeries(incomeSeries, true);
    }

    // Passengers
    const passengerData = Array.isArray(res?.passengers) ? res.passengers : [];
    const labels = passengerData.map((d: any) => d.estado);
    const passengerSeries = passengerData.map((d: any) => Number(d.cantidad) || 0);
    const passengerTotal = passengerSeries.reduce((acc: number, curr: number) => acc + curr, 0);
    this.hasPassengerData = passengerTotal > 0;
    this.passengerChartOptions = {
      ...this.passengerChartOptions,
      labels,
      series: this.hasPassengerData ? passengerSeries : []
    };

    if (this.chartPassengers) {
      this.chartPassengers.updateOptions({ labels, series: this.hasPassengerData ? passengerSeries : [] }, true, true);
      this.chartPassengers.updateSeries(this.hasPassengerData ? passengerSeries : [], true);
    }

    // Occupancy
    const occupancyData = Array.isArray(res?.occupancy) ? res.occupancy : [];
    const categories = occupancyData.map((d: any) => d.Nombre_Tour);
    const occupancySeriesData = occupancyData.map((d: any) => Number(d.pasajeros) || 0);
    this.hasOccupancyData = occupancySeriesData.some((value: number) => value > 0);
    const occupancySeries = [{ name: 'Pasajeros', data: this.hasOccupancyData ? occupancySeriesData : [0] }];
    this.occupancyChartOptions = {
      ...this.occupancyChartOptions,
      xaxis: {
        ...this.occupancyChartOptions.xaxis,
        categories: this.hasOccupancyData ? categories : []
      },
      series: occupancySeries
    };

    if (this.chartOccupancy) {
      this.chartOccupancy.updateOptions({
        xaxis: {
          ...this.occupancyChartOptions.xaxis,
          categories: this.hasOccupancyData ? categories : []
        },
        series: occupancySeries
      }, true, true);
      this.chartOccupancy.updateSeries(occupancySeries, true);
    }

    this.cdr.detectChanges();
  }

  private forceChartsReflow() {
    // 2 frames + timeout corto para cuando hay animaciones/layout/fonts
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
      });
    });

    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 180);
  }

  loadData(initial = false) {
    const requestId = ++this.dashboardRequestId;
    const filters = {
      startDate: this.startDate || undefined,
      endDate: this.endDate || undefined
    };
    let hasPartialError = false;

    if (initial) {
      this.isInitialLoading = true;
      this.isLoading = true;
    } else {
      this.isRefreshing = true;
    }
    this.cdr.detectChanges();

    this.navbar.alert.set(null);

    forkJoin({
      stats: this.dashboardService.getStats(filters).pipe(
        catchError((err) => {
          console.error('Dashboard stats error:', err);
          hasPartialError = true;
          return of(null);
        })
      ),
      income: this.dashboardService.getIncomeHistory(new Date().getFullYear()).pipe(
        catchError((err) => {
          console.error('Dashboard income error:', err);
          hasPartialError = true;
          return of([]);
        })
      ),
      passengers: this.dashboardService.getPassengerDistribution(filters).pipe(
        catchError((err) => {
          console.error('Dashboard passengers error:', err);
          hasPartialError = true;
          return of([]);
        })
      ),
      occupancy: this.dashboardService.getTourOccupancy(filters).pipe(
        catchError((err) => {
          console.error('Dashboard occupancy error:', err);
          hasPartialError = true;
          return of([]);
        })
      )
    })
      .pipe(
        finalize(() => {
          if (requestId !== this.dashboardRequestId) return;
          this.isInitialLoading = false;
          this.isRefreshing = false;
          this.isLoading = false;
          const current = this.navbar.alert();
          if (current?.loading) this.navbar.alert.set(null);
          this.cdr.detectChanges();
        })
      )
      .subscribe({
        next: (res) => {
          if (requestId !== this.dashboardRequestId) return;
          this.lastResponse = res;

          this.totalReservas = Number(res?.stats?.totalReservas || 0);
          this.totalPasajeros = Number(res?.stats?.totalPasajeros || 0);
          this.totalIngresos = Number(res?.stats?.totalIngresos || 0);
          this.totalTransfers = Number(res?.stats?.totalTransfers || 0);

          if (this.viewReady) {
            this.applyChartData({
              income: Array.isArray(res?.income) ? res.income : [],
              passengers: Array.isArray(res?.passengers) ? res.passengers : [],
              occupancy: Array.isArray(res?.occupancy) ? res.occupancy : []
            });
            this.forceChartsReflow();
          }

          if (hasPartialError) {
            this.navbar.alert.set({
              title: 'Dashboard parcialmente cargado',
              message: 'Algunas métricas no pudieron cargarse.',
              type: 'warning',
              autoClose: true
            });
          }

          this.cdr.detectChanges();
        },
        error: (err) => {
          if (requestId !== this.dashboardRequestId) return;
          console.error('Dashboard Error:', err);
          this.totalReservas = 0;
          this.totalPasajeros = 0;
          this.totalIngresos = 0;
          this.totalTransfers = 0;
          this.hasIncomeData = false;
          this.hasPassengerData = false;
          this.hasOccupancyData = false;
          this.applyChartData({ income: [], passengers: [], occupancy: [] });
          this.navbar.alert.set({
            title: 'Dashboard parcialmente cargado',
            message: 'Algunas métricas no pudieron cargarse.',
            type: 'warning',
            autoClose: true,
          });
          this.cdr.detectChanges();
        }
      });
  }

  onDateRangeChange(field: 'startDate' | 'endDate', value: string): void {
    if (!value) return;

    this[field] = value;

    if (this.startDate && this.endDate && this.startDate > this.endDate) {
      if (field === 'startDate') {
        this.endDate = this.startDate;
      } else {
        this.startDate = this.endDate;
      }
    }

    this.syncDatePickers();
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);

    this.refreshTimer = setTimeout(() => {
      this.loadData(false);
    }, 180);
  }

  setTomorrowRange() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const tomorrow = this.getTomorrowDateValue();
    this.startDate = tomorrow;
    this.endDate = tomorrow;
    this.syncDatePickers();
    this.loadData(false);
  }

  setTodayRange() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const today = this.toDateInputValue(new Date());
    this.startDate = today;
    this.endDate = today;
    this.syncDatePickers();
    this.loadData(false);
  }

  get activeRangeLabel(): string {
    if (!this.startDate || !this.endDate) return 'Sin rango definido';
    if (this.startDate === this.endDate) return `Operación: ${this.startDate}`;
    return `Rango: ${this.startDate} — ${this.endDate}`;
  }

  isTodayRange(): boolean {
    const today = this.toDateInputValue(new Date());
    return this.startDate === today && this.endDate === today;
  }

  isTomorrowRange(): boolean {
    const tomorrow = this.getTomorrowDateValue();
    return this.startDate === tomorrow && this.endDate === tomorrow;
  }

  hasAnyActivity(): boolean {
    return this.totalReservas > 0 || this.totalPasajeros > 0 || this.totalIngresos > 0 || this.totalTransfers > 0;
  }

  getOperationVolumeLabel(): string {
    if (this.totalPasajeros >= 100) return 'Alto';
    if (this.totalPasajeros >= 30) return 'Medio';
    if (this.totalPasajeros > 0) return 'Bajo';
    return 'Sin operación';
  }

  getOperationVolumeClass(): string {
    if (this.totalPasajeros >= 100) return 'high';
    if (this.totalPasajeros >= 30) return 'medium';
    if (this.totalPasajeros > 0) return 'low';
    return 'none';
  }

  get averagePassengersPerBooking(): number | null {
    if (!this.totalReservas) return null;
    return this.totalPasajeros / this.totalReservas;
  }

  get averageIncomePerBooking(): number | null {
    if (!this.totalReservas) return null;
    return this.totalIngresos / this.totalReservas;
  }
}
