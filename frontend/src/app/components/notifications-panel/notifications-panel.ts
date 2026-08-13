import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SirDrawerService } from '../../services/Drawer/drawer.service';
import { NotificacionesService } from '../../services/Notificaciones/notificaciones.service';
import { IntercambioTurno, TurnosService } from '../../services/Turnos/turnos.service';
import { SirAlertService } from '../../services/Alertas/alert.service';

@Component({
  selector: 'app-notifications-panel', standalone: true, imports: [CommonModule],
  template: `
    <header class="panel-header"><div><span class="eyebrow">Centro personal</span><h2>Notificaciones</h2></div>
      <button class="close" type="button" (click)="close()" aria-label="Cerrar"><i class="bx bx-x"></i></button></header>
    <div class="panel-toolbar"><span>{{ notifications.noLeidas() }} sin leer</span>
      @if (notifications.noLeidas()) { <button type="button" (click)="notifications.markAllRead()">Marcar todas como leídas</button> }</div>
    <div class="panel-body">
      @if (pending().length) {
        <section><span class="section-label">Requieren tu respuesta</span>
          @for (item of pending(); track item.idIntercambio) {
            <article class="request-card"><div><strong>{{ item.solicitante }} solicita cambiar el turno</strong>
              <p>{{ dateLabel(item.fecha) }} · recibirías {{ time(item.horarioSolicitante.inicio) }}–{{ time(item.horarioSolicitante.fin) }}</p>
              @if (item.motivo) { <small>“{{ item.motivo }}”</small> }</div>
              <div class="actions"><button type="button" class="secondary" [disabled]="busy()" (click)="respond(item,false)">Rechazar</button>
                <button type="button" class="primary" [disabled]="busy()" (click)="respond(item,true)">Aceptar cambio</button></div></article>
          }
        </section>
      }
      @if (outgoing().length) {
        <section><span class="section-label">Esperando respuesta</span>
          @for (item of outgoing(); track item.idIntercambio) {
            <article class="request-card"><div><strong>Solicitud enviada a {{ item.receptor }}</strong>
              <p>{{ dateLabel(item.fecha) }} · propusiste intercambiar {{ time(item.horarioSolicitante.inicio) }}–{{ time(item.horarioSolicitante.fin) }}</p></div>
              <div class="actions"><button type="button" class="secondary" [disabled]="busy()" (click)="cancel(item)">Cancelar solicitud</button></div></article>
          }
        </section>
      }
      <section><span class="section-label">Actividad reciente</span>
        @for (item of notifications.items(); track item.idNotificacion) {
          <button type="button" class="notification" [class.unread]="!item.leida" (click)="notifications.markRead(item.idNotificacion)">
            <span class="dot"></span><span><strong>{{ item.titulo }}</strong><small>{{ item.mensaje }}</small><time>{{ relative(item.fechaCreacion) }}</time></span>
          </button>
        } @empty { <div class="empty"><strong>Todo está al día</strong><p>Las solicitudes y avisos importantes aparecerán aquí.</p></div> }
      </section>
    </div>`,
  styles: [`
    :host{display:flex;flex-direction:column;height:100%;background:var(--bg-secondary);color:var(--text-primary)}
    .panel-header{display:flex;align-items:center;justify-content:space-between;padding:24px;border-bottom:1px solid var(--border-color)}h2{margin:4px 0 0;font-size:24px}.eyebrow,.section-label{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}
    .close{width:36px;height:36px;border:1px solid var(--border-color);border-radius:var(--radius-md);background:var(--bg-tertiary);color:var(--text-secondary);font-size:20px}.panel-toolbar{display:flex;justify-content:space-between;padding:12px 24px;border-bottom:1px solid var(--border-color);font-size:13px;color:var(--text-secondary)}.panel-toolbar button{border:0;background:none;color:var(--accent-blue);font-weight:600}.panel-body{overflow:auto;padding:20px 24px 36px}section{display:grid;gap:10px;margin-bottom:26px}.request-card{padding:16px;border:1px solid color-mix(in srgb,var(--accent-blue) 35%,var(--border-color));border-radius:var(--radius-lg);background:color-mix(in srgb,var(--accent-blue) 8%,var(--bg-tertiary))}.request-card p,.request-card small{display:block;margin:6px 0 0;color:var(--text-secondary);line-height:1.45}.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.actions button{min-height:38px;padding:0 14px;border-radius:var(--radius-md);font-weight:650}.secondary{border:1px solid var(--border-color);background:transparent;color:var(--text-primary)}.primary{border:1px solid var(--accent-blue);background:var(--accent-blue);color:#fff}
    .notification{display:grid;grid-template-columns:8px 1fr;gap:10px;width:100%;padding:14px;text-align:left;border:1px solid var(--border-color);border-radius:var(--radius-lg);background:var(--bg-tertiary);color:var(--text-primary)}.notification .dot{width:7px;height:7px;margin-top:6px;border-radius:50%;background:transparent}.notification.unread .dot{background:var(--accent-blue)}.notification small,.notification time{display:block;margin-top:4px;color:var(--text-secondary);line-height:1.4}.notification time{font-size:11px}.empty{padding:42px 16px;text-align:center;color:var(--text-secondary)}.empty p{margin:7px 0 0}@media(max-width:560px){.panel-header,.panel-body{padding-left:18px;padding-right:18px}.actions{display:grid;grid-template-columns:1fr 1fr}}
  `]
})
export class NotificationsPanelComponent implements OnInit {
  readonly notifications=inject(NotificacionesService); private readonly turnos=inject(TurnosService);
  private readonly drawer=inject(SirDrawerService); private readonly alerts=inject(SirAlertService);
  readonly exchanges=signal<IntercambioTurno[]>([]); readonly busy=signal(false);
  readonly pending=()=>this.exchanges().filter(i=>!i.esSolicitante&&i.estado==='pendiente');
  readonly outgoing=()=>this.exchanges().filter(i=>i.esSolicitante&&i.estado==='pendiente');
  ngOnInit(){this.reload();}
  close(){this.drawer.close();}
  reload(){this.notifications.load();this.turnos.obtenerMisIntercambios().subscribe({next:r=>this.exchanges.set(r.intercambios||[])});}
  respond(item:IntercambioTurno,accept:boolean){this.busy.set(true);this.turnos.responderIntercambio(item.idIntercambio,accept).subscribe({next:()=>{this.busy.set(false);this.alerts.successToast(accept?'Turno intercambiado':'Solicitud rechazada',accept?'Ambos horarios ya fueron actualizados para ese día.':'La jornada no cambió.');this.reload();},error:e=>{this.busy.set(false);this.alerts.errorToast('No se pudo responder',e?.error?.message||'Inténtalo nuevamente.');}});}
  cancel(item:IntercambioTurno){this.busy.set(true);this.turnos.cancelarIntercambio(item.idIntercambio).subscribe({next:()=>{this.busy.set(false);this.alerts.infoToast('Solicitud cancelada','Ningún horario fue modificado.');this.reload();},error:e=>{this.busy.set(false);this.alerts.errorToast('No se pudo cancelar',e?.error?.message||'Inténtalo nuevamente.');}});}
  time(v:string){const [h,m]=v.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'p. m.':'a. m.'}`;}
  dateLabel(v:string){return new Intl.DateTimeFormat('es-CO',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(v+'T00:00:00Z'));}
  relative(v:string){return new Intl.DateTimeFormat('es-CO',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(v));}
}
