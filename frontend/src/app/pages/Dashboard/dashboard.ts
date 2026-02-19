import { CommonModule } from '@angular/common';
import { Component, ViewChild, inject, OnInit, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, finalize } from 'rxjs';

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
  imports: [CommonModule, NgApexchartsModule, FormsModule],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.css']
})
export class DashboardComponent implements OnInit, AfterViewInit {
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

  // OPTIONS
  public incomeChartOptions: Partial<ChartOptions> | any;
  public passengerChartOptions: Partial<ChartOptions> | any;
  public occupancyChartOptions: Partial<ChartOptions> | any;

  // FLAGS / CACHE
  private viewReady = false;
  private lastResponse: any = null;

  ngOnInit() {
    this.initCharts();
    this.loadData();
  }

  ngAfterViewInit() {
    this.viewReady = true;

    // Si la data llegó antes del view, la aplicamos acá
    if (this.lastResponse) {
      this.applyChartData(this.lastResponse);
      this.forceChartsReflow();
    }
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

  private applyChartData(res: any) {
    // Income
    if (res.income) {
      const series = [{ name: 'Ingresos', data: res.income }];

      if (this.chartIncome) this.chartIncome.updateSeries(series, true);
      else this.incomeChartOptions = { ...this.incomeChartOptions, series };
    }

    // Passengers
    if (res.passengers) {
      const labels = res.passengers.map((d: any) => d.estado);
      const series = res.passengers.map((d: any) => Number(d.cantidad));

      if (this.chartPassengers) {
        this.chartPassengers.updateOptions({ labels }, true, true);
        this.chartPassengers.updateSeries(series, true);
      } else {
        this.passengerChartOptions = { ...this.passengerChartOptions, labels, series };
      }
    }

    // Occupancy
    if (res.occupancy) {
      const categories = res.occupancy.map((d: any) => d.Nombre_Tour);
      const series = [{ name: 'Pasajeros', data: res.occupancy.map((d: any) => Number(d.pasajeros)) }];

      if (this.chartOccupancy) {
        this.chartOccupancy.updateOptions({ xaxis: { categories } }, true, true);
        this.chartOccupancy.updateSeries(series, true);
      } else {
        this.occupancyChartOptions = {
          ...this.occupancyChartOptions,
          xaxis: { ...this.occupancyChartOptions.xaxis, categories },
          series
        };
      }
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

  loadData() {
    const filters = {
      startDate: this.startDate || undefined,
      endDate: this.endDate || undefined
    };

    this.navbar.alert.set({
      title: 'Cargando',
      message: 'Actualizando Dashboard...',
      loading: true,
      autoClose: false
    });

    forkJoin({
      stats: this.dashboardService.getStats(filters),
      income: this.dashboardService.getIncomeHistory(new Date().getFullYear()),
      passengers: this.dashboardService.getPassengerDistribution(filters),
      occupancy: this.dashboardService.getTourOccupancy(filters)
    })
      .pipe(
        finalize(() => {
          this.navbar.alert.set(null);
        })
      )
      .subscribe({
        next: (res) => {
          this.lastResponse = res;

          if (res.stats) {
            this.totalReservas = res.stats.totalReservas || 0;
            this.totalPasajeros = res.stats.totalPasajeros || 0;
            this.totalIngresos = res.stats.totalIngresos || 0;
            this.totalTransfers = res.stats.totalTransfers || 0;
          }

          if (this.viewReady) {
            this.applyChartData(res);
            this.forceChartsReflow();
          }
        },
        error: (err) => {
          console.error('Dashboard Error:', err);
          this.navbar.alert.set({
            title: 'Error',
            message: 'No se pudo cargar la información del Dashboard',
            type: 'error'
          });
        }
      });
  }

  applyFilters() {
    this.loadData();
  }
}
