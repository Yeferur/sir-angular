import { signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { SirSelectOption } from '../../shared/select/select';
import type { SirDrawerService } from '../../services/Drawer/drawer.service';
import type { PermisosService } from '../../services/Permisos/permisos.service';
import type { Reservas, EntidadReportante } from '../../services/Reservas/reservas';
import { claveNombreEntidad } from './entidad-reportante.utils';

const entityTypes: SirSelectOption[] = [
  { value: 'HOTEL', label: 'Hotel' },
  { value: 'AGENCIA_NACIONAL', label: 'Agencia nacional' },
  { value: 'AGENCIA_INTERNACIONAL', label: 'Agencia internacional' },
];

type EntityType = EntidadReportante['Tipo'];
type EntityApi = Pick<Reservas, 'getEntidadesReportantes' | 'registrarEntidadReportanteRapida'>;

/** Adapta el drawer global de entidades al formulario de reserva que lo abrió. */
export class ReservaEntidadCreateDrawerController {
  readonly createTypeOptions = entityTypes;
  readonly canValidate: boolean;
  readonly suggesting = signal(false);
  readonly entitySuggestions = signal<EntidadReportante[]>([]);
  readonly saving = signal(false);
  readonly detailError = signal('');

  type: EntityType;
  name: string;

  private suggestionTimer: ReturnType<typeof setTimeout> | null = null;
  private suggestionRun = 0;

  constructor(
    private readonly reservas: EntityApi,
    private readonly drawer: SirDrawerService,
    permissions: PermisosService,
    private readonly getChannelIdForType: (type: EntityType) => number | null,
    private readonly onEntitySelected: (entity: EntidadReportante, channelId: number) => Promise<void>,
    private readonly onClose: () => void,
    initialType: EntityType,
    initialName: string,
  ) {
    this.canValidate = permissions.tienePermiso('ENTIDADES_REPORTANTES.VALIDAR');
    this.type = initialType;
    this.name = initialName;
  }

  get exactDuplicate(): EntidadReportante | null {
    const key = claveNombreEntidad(this.name);
    return key ? this.entitySuggestions().find(entity =>
      entity.Tipo === this.type && claveNombreEntidad(entity.Nombre) === key) || null : null;
  }

  exactDuplicateMessage(): string {
    const duplicate = this.exactDuplicate;
    if (!duplicate) return '';
    if (!Number(duplicate.Activo) || duplicate.Estado_Validacion === 'RECHAZADA') {
      return `${duplicate.Nombre} ya existe, pero está inactiva o rechazada. Solicita su revisión.`;
    }
    return `Ya existe ${duplicate.Nombre}. Selecciónala en las sugerencias para continuar.`;
  }

  open(): void {
    this.drawer.openEntityCreate({ controller: this });
    this.queueSuggestions();
  }

  close(): void {
    this.clearSuggestions();
    const current = this.drawer.drawer();
    if (current?.type === 'entity-create' && current.props?.['controller'] === this) this.drawer.close();
    this.onClose();
  }

  dispose(): void {
    this.clearSuggestions();
  }

  onCreateNameChange(value: string): void {
    this.name = value;
    this.detailError.set('');
    this.queueSuggestions();
  }

  onCreateTypeChange(value: EntityType): void {
    this.type = value;
    this.detailError.set('');
    this.queueSuggestions();
  }

  openSuggestedEntity(entity: EntidadReportante): void {
    if (!Number(entity.Activo) || entity.Estado_Validacion === 'RECHAZADA') {
      this.detailError.set(`${entity.Nombre} está inactiva o fue rechazada. Solicita su revisión antes de usarla.`);
      return;
    }
    const channelId = this.getChannelIdForType(entity.Tipo);
    if (channelId === null) {
      this.detailError.set('No hay un canal configurado para el tipo de entidad seleccionado.');
      return;
    }
    void this.selectAndClose(entity, channelId);
  }

  typeLabel(type: EntityType): string {
    return {
      HOTEL: 'Hotel',
      AGENCIA_NACIONAL: 'Agencia nacional',
      AGENCIA_INTERNACIONAL: 'Agencia internacional',
    }[type];
  }

  async save(): Promise<void> {
    const name = this.name.trim();
    if (this.saving() || name.length < 2 || !this.type) return;
    if (this.exactDuplicate) {
      this.detailError.set(this.exactDuplicateMessage());
      return;
    }

    const channelId = this.getChannelIdForType(this.type);
    if (channelId === null) {
      this.detailError.set('No hay un canal configurado para el tipo de entidad seleccionado.');
      return;
    }

    this.saving.set(true);
    this.detailError.set('');
    try {
      const entity = await firstValueFrom(this.reservas.registrarEntidadReportanteRapida(channelId, name));
      if (!Number(entity.Activo) || entity.Estado_Validacion === 'RECHAZADA') {
        this.detailError.set(`${entity.Nombre} está inactiva o fue rechazada. Solicita su revisión antes de usarla.`);
        return;
      }
      await this.selectAndClose(entity, channelId);
    } catch (error: any) {
      this.detailError.set(error?.error?.message || 'No se pudo registrar la entidad. Revisa el nombre e intenta nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }

  private async selectAndClose(entity: EntidadReportante, channelId: number): Promise<void> {
    try {
      await this.onEntitySelected(entity, channelId);
      this.close();
    } catch (error: any) {
      this.detailError.set(error?.error?.message || 'La entidad se creó, pero no se pudo seleccionar en la reserva.');
    }
  }

  private queueSuggestions(): void {
    this.clearSuggestions();
    this.entitySuggestions.set([]);
    this.suggesting.set(false);
    const name = this.name.trim();
    if (name.length < 2) {
      this.entitySuggestions.set([]);
      this.suggesting.set(false);
      return;
    }

    const run = ++this.suggestionRun;
    this.suggestionTimer = setTimeout(async () => {
      this.suggesting.set(true);
      try {
        const items = await firstValueFrom(this.reservas.getEntidadesReportantes(this.type, name, true));
        if (run === this.suggestionRun) this.entitySuggestions.set(items || []);
      } catch {
        if (run === this.suggestionRun) {
          this.entitySuggestions.set([]);
          this.detailError.set('No se pudieron cargar las sugerencias. Puedes escribir el nombre manualmente.');
        }
      } finally {
        if (run === this.suggestionRun) this.suggesting.set(false);
      }
    }, 250);
  }

  private clearSuggestions(): void {
    if (this.suggestionTimer) clearTimeout(this.suggestionTimer);
    this.suggestionTimer = null;
    this.suggestionRun++;
  }
}
