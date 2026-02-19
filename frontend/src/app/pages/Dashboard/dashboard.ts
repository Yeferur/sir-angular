import { Component, inject, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DashboardService } from '../../services/dashboard.service';
import {
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
    ApexPlotOptions,
    NgApexchartsModule,
    ChartComponent
} from 'ng-apexcharts';

export type ChartOptions = {
    series: ApexAxisChartSeries | any;
    chart: ApexChart;
    xaxis: ApexXAxis;
    title: ApexTitleSubtitle;
    stroke: ApexStroke;
    fill: ApexFill;
    tooltip: ApexTooltip;
    dataLabels: ApexDataLabels;
    yaxis: ApexYAxis;
    grid: ApexGrid;
    legend: ApexLegend;
    plotOptions: ApexPlotOptions;
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
export class DashboardComponent implements OnInit {
    private dashboardService = inject(DashboardService);

    // STATS
    totalReservas = 0;
    totalPasajeros = 0;
    totalIngresos = 0;
    totalTransfers = 0;

    // FILTERS
    startDate = '';
    endDate = '';

    // CHARTS
    @ViewChild('chartIncome') chartIncome!: ChartComponent;
    public incomeChartOptions: Partial<ChartOptions> | any;

    @ViewChild('chartPassengers') chartPassengers!: ChartComponent;
    public passengerChartOptions: Partial<ChartOptions> | any;

    @ViewChild('chartOccupancy') chartOccupancy!: ChartComponent;
    public occupancyChartOptions: Partial<ChartOptions> | any;

    ngOnInit() {
        this.initChats();
        this.loadData();
    }

    initChats() {
        // 1. INCOME CHART (Area Gradient)
        this.incomeChartOptions = {
            series: [{ name: "Ingresos", data: [] }],
            chart: {
                type: "area",
                height: 350,
                toolbar: { show: false },
                fontFamily: 'Inter, sans-serif',
                background: 'transparent'
            },
            dataLabels: { enabled: false },
            stroke: { curve: "smooth", width: 3 },
            xaxis: {
                categories: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
                labels: { style: { colors: '#a3a3a3' } },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis: {
                labels: {
                    style: { colors: '#a3a3a3' },
                    formatter: (value: number) => {
                        return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumSignificantDigits: 3 }).format(value);
                    }
                }
            },
            fill: {
                type: "gradient",
                gradient: {
                    shadeIntensity: 1,
                    opacityFrom: 0.7,
                    opacityTo: 0.1,
                    stops: [0, 90, 100]
                }
            },
            colors: ['#ffd700'], // Gold
            grid: {
                borderColor: '#333',
                strokeDashArray: 4,
                yaxis: { lines: { show: true } },
                xaxis: { lines: { show: false } }
            },
            tooltip: { theme: 'dark' }
        };

        // 2. PASSENGER DISTRIBUTION (Donut)
        this.passengerChartOptions = {
            series: [],
            chart: { type: "donut", height: 350, fontFamily: 'Inter, sans-serif', background: 'transparent' },
            labels: [],
            colors: ['#00E396', '#FEB019', '#FF4560'], // Green, Yellow, Red
            legend: { position: 'bottom', labels: { colors: '#fff' } },
            dataLabels: { enabled: true },
            plotOptions: {
                pie: {
                    donut: {
                        size: '65%',
                        labels: {
                            show: true,
                            total: {
                                show: true,
                                label: 'Total',
                                color: '#fff',
                                fontSize: '20px',
                                fontWeight: 600
                            },
                            value: { color: '#fff' }
                        }
                    }
                }
            },
            stroke: { show: false },
            tooltip: { theme: 'dark' }
        };

        // 3. TOUR OCCUPANCY (Bar)
        this.occupancyChartOptions = {
            series: [{ name: "Pasajeros", data: [] }],
            chart: { type: "bar", height: 350, toolbar: { show: false }, fontFamily: 'Inter, sans-serif', background: 'transparent' },
            plotOptions: {
                bar: {
                    horizontal: true,
                    borderRadius: 4,
                    barHeight: '70%',
                    distributed: true // colorful bars
                }
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

    loadData() {
        const filters = {
            startDate: this.startDate || undefined,
            endDate: this.endDate || undefined
        };

        // Stats Card
        this.dashboardService.getStats(filters).subscribe(res => {
            this.totalReservas = res.totalReservas;
            this.totalPasajeros = res.totalPasajeros;
            this.totalIngresos = res.totalIngresos;
            this.totalTransfers = res.totalTransfers;
        });

        // Income History (Line Chart) - Always full year for now
        this.dashboardService.getIncomeHistory(new Date().getFullYear()).subscribe(data => {
            this.incomeChartOptions.series = [{ name: "Ingresos", data: data }];
        });

        // Passenger Dist (Donut)
        this.dashboardService.getPassengerDistribution(filters).subscribe(data => {
            // Map: Confirmado, Pendiente, Cancelado
            // data: [{ estado: 'Confirmado', cantidad: 10 }, ...]
            const labels = data.map(d => d.estado);
            const series = data.map(d => Number(d.cantidad));

            this.passengerChartOptions.series = series;
            this.passengerChartOptions.labels = labels;

            // Dynamic colors based on labels if needed
        });

        // Tour Occupancy (Bar)
        this.dashboardService.getTourOccupancy(filters).subscribe(data => {
            const categories = data.map(d => d.Nombre_Tour);
            const seriesData = data.map(d => Number(d.pasajeros));

            this.occupancyChartOptions.series = [{ name: "Pasajeros", data: seriesData }];
            this.occupancyChartOptions.xaxis.categories = categories;
        });
    }

    applyFilters() {
        this.loadData();
    }
}
