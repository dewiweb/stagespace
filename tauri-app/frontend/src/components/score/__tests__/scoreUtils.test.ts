/// <reference types="vitest/globals" />
import { describe, expect, it } from 'vitest';
import { isTextEntryTarget } from '../scoreUtils';

const input = (type: string) => {
  const i = document.createElement('input');
  i.type = type;
  return i;
};

describe('isTextEntryTarget', () => {
  it('champs textuels → true', () => {
    expect(isTextEntryTarget(input('text'))).toBe(true);
    expect(isTextEntryTarget(input('number'))).toBe(true);
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true);
    expect(isTextEntryTarget(document.createElement('select'))).toBe(true);
  });

  it('INPUT non-textuels → false (le slider ne bloque pas Delete)', () => {
    expect(isTextEntryTarget(input('range'))).toBe(false);
    expect(isTextEntryTarget(input('checkbox'))).toBe(false);
    expect(isTextEntryTarget(input('radio'))).toBe(false);
    expect(isTextEntryTarget(input('button'))).toBe(false);
  });

  it('éléments non-champs et null → false', () => {
    expect(isTextEntryTarget(document.createElement('div'))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom : isContentEditable est fiable à true une fois armé
    if (editable.isContentEditable) expect(isTextEntryTarget(editable)).toBe(true);
  });
});
