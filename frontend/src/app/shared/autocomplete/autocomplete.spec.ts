describe('estilos compartidos de autocompletes', () => {
  let fixture: HTMLDivElement;

  beforeEach(() => {
    fixture = document.createElement('div');
    fixture.innerHTML = `
      <div class="autocomplete-test-anchor" style="position:relative;width:320px">
        <input class="form-input" aria-label="Entidad" />
        <input class="form-input" aria-label="Entidad deshabilitada" disabled />
        <div class="sir-autocomplete-panel sir-autocomplete-panel--overlay sir-autocomplete-panel--form sir-autocomplete-enter" role="listbox">
          <button class="sir-autocomplete-option" role="option">Entidad con nombre largo</button>
          <button class="sir-autocomplete-option" role="option" disabled>Deshabilitada</button>
        </div>
      </div>`;
    document.body.appendChild(fixture);
  });

  afterEach(() => fixture.remove());

  it('mantiene la geometría cerrada de los campos de formulario', () => {
    const input = fixture.querySelector('input')!;
    const style = getComputedStyle(input);
    expect(style.height).toBe('40px');
    expect(style.borderTopWidth).toBe('1px');
    expect(style.borderRadius).toBe('8px');
    expect(style.paddingLeft).toBe('13px');
    expect(style.fontSize).toBe('14px');
    expect(style.fontWeight).toBe('500');
    expect(style.transitionDuration).toContain('0.18s');

    input.focus();
    expect(getComputedStyle(input).boxShadow).not.toBe('none');
    expect(getComputedStyle(fixture.querySelector<HTMLInputElement>('input:disabled')!).opacity).toBe('0.72');
  });

  it('comparte paneles y opciones sin truncar nombres largos', () => {
    const panel = fixture.querySelector<HTMLElement>('[role="listbox"]')!;
    const option = fixture.querySelector<HTMLElement>('[role="option"]')!;
    const disabled = fixture.querySelector<HTMLButtonElement>('button:disabled')!;
    const panelStyle = getComputedStyle(panel);
    const optionStyle = getComputedStyle(option);

    expect(panelStyle.borderTopWidth).toBe('1px');
    expect(panelStyle.borderRadius).toBe('12px');
    expect(panelStyle.position).toBe('absolute');
    expect(Number.parseFloat(panelStyle.maxHeight)).toBeLessThanOrEqual(280);
    expect(panelStyle.animationDuration).toBe('0.18s');
    expect(optionStyle.fontSize).toBe('14px');
    expect(optionStyle.fontWeight).toBe('500');
    expect(optionStyle.borderRadius).toBe('8px');
    expect(optionStyle.overflowWrap).toBe('anywhere');
    expect(getComputedStyle(disabled).opacity).toBe('0.55');
    expect(panelStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(panelStyle.boxShadow).not.toBe('none');
  });
});
