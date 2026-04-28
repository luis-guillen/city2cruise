/**
 * Hito 4.1.3 — Test de contraste WCAG 2.1 AA.
 *
 * Calcula los ratios reales de los tokens definidos en index.css y verifica
 * que cumplen WCAG 2.1 AA para texto normal (>=4.5:1) y texto grande (>=3:1).
 *
 * Si necesitas cambiar el threshold (ej: AAA), define:
 *   A11Y_CONTRAST_NORMAL=7 npm test -- src/__tests__/a11y/contrast
 */
import { describe, it, expect } from 'vitest';

const NORMAL = Number(process.env.A11Y_CONTRAST_NORMAL ?? 4.5);
const LARGE = Number(process.env.A11Y_CONTRAST_LARGE ?? 3.0);

function srgbChannel(c: number): number {
  c = c / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (
    0.2126 * srgbChannel(r) +
    0.7152 * srgbChannel(g) +
    0.0722 * srgbChannel(b)
  );
}

function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const L1 = Math.max(la, lb);
  const L2 = Math.min(la, lb);
  return (L1 + 0.05) / (L2 + 0.05);
}

// Tokens espejo de :root en index.css (mantener sincronizado).
const palette = {
  textPrimary: '#1C1C1E',
  textSecondary: '#5C5C61',
  textTertiary: '#6E6E73',
  bgPrimary: '#F2F2F7',
  bgWhite: '#FFFFFF',
  blueAa: '#0066CC',
  redAa: '#D70015',
  orangeAa: '#995700',
};

const highContrast = {
  textPrimary: '#000000',
  textSecondary: '#2A2A2D',
  textTertiary: '#424247',
  bgWhite: '#FFFFFF',
  blue: '#0050A0',
  red: '#A50012',
};

describe('Hito 4.1.3 — Contraste WCAG 2.1 AA', () => {
  describe('Modo estándar', () => {
    it('text-primary sobre bg-primary >= 4.5:1', () => {
      expect(contrastRatio(palette.textPrimary, palette.bgPrimary)).toBeGreaterThanOrEqual(NORMAL);
    });
    it('text-primary sobre blanco >= 4.5:1', () => {
      expect(contrastRatio(palette.textPrimary, palette.bgWhite)).toBeGreaterThanOrEqual(NORMAL);
    });
    it('text-secondary sobre bg-primary >= 4.5:1', () => {
      expect(contrastRatio(palette.textSecondary, palette.bgPrimary)).toBeGreaterThanOrEqual(NORMAL);
    });
    it('text-secondary sobre blanco >= 4.5:1', () => {
      expect(contrastRatio(palette.textSecondary, palette.bgWhite)).toBeGreaterThanOrEqual(NORMAL);
    });
    it('text-tertiary sobre blanco >= 4.5:1', () => {
      expect(contrastRatio(palette.textTertiary, palette.bgWhite)).toBeGreaterThanOrEqual(NORMAL);
    });
    it('blue-aa sobre blanco >= 4.5:1', () => {
      expect(contrastRatio(palette.blueAa, palette.bgWhite)).toBeGreaterThanOrEqual(NORMAL);
    });
    it('red-aa sobre blanco >= 4.5:1', () => {
      expect(contrastRatio(palette.redAa, palette.bgWhite)).toBeGreaterThanOrEqual(NORMAL);
    });
    it('orange-aa sobre blanco >= 4.5:1', () => {
      expect(contrastRatio(palette.orangeAa, palette.bgWhite)).toBeGreaterThanOrEqual(NORMAL);
    });
  });

  describe('Modo alto contraste (data-a11y-contrast="high")', () => {
    it('text-primary >= 7:1 (AAA)', () => {
      expect(contrastRatio(highContrast.textPrimary, highContrast.bgWhite)).toBeGreaterThanOrEqual(7);
    });
    it('text-secondary >= 7:1 (AAA)', () => {
      expect(contrastRatio(highContrast.textSecondary, highContrast.bgWhite)).toBeGreaterThanOrEqual(7);
    });
    it('text-tertiary >= 4.5:1 (AA)', () => {
      expect(contrastRatio(highContrast.textTertiary, highContrast.bgWhite)).toBeGreaterThanOrEqual(NORMAL);
    });
    it('blue >= 7:1 (AAA)', () => {
      expect(contrastRatio(highContrast.blue, highContrast.bgWhite)).toBeGreaterThanOrEqual(7);
    });
    it('red >= 7:1 (AAA)', () => {
      expect(contrastRatio(highContrast.red, highContrast.bgWhite)).toBeGreaterThanOrEqual(7);
    });
  });

  describe('Componentes / iconos no-texto (>=3:1)', () => {
    // Para iconos que indican estado, se exige al menos 3:1 (1.4.11)
    it('blue-aa >= 3:1 sobre bg-primary', () => {
      expect(contrastRatio(palette.blueAa, palette.bgPrimary)).toBeGreaterThanOrEqual(LARGE);
    });
    it('red-aa >= 3:1 sobre bg-primary', () => {
      expect(contrastRatio(palette.redAa, palette.bgPrimary)).toBeGreaterThanOrEqual(LARGE);
    });
  });
});
