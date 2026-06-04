import { CMYK, RGB } from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const normalizeHex = (hex?: string): string | null => {
  if (!hex) return null;
  const normalized = hex.trim().replace('#', '');
  if (![3, 6].includes(normalized.length)) return null;
  const expanded = normalized.length === 3 ? normalized.split('').map((char) => char + char).join('') : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  return `#${expanded.toUpperCase()}`;
};

export const normalizeRgb = (input?: Partial<RGB>): RGB => ({
  r: clamp(Math.round(input?.r ?? 0), 0, 255),
  g: clamp(Math.round(input?.g ?? 0), 0, 255),
  b: clamp(Math.round(input?.b ?? 0), 0, 255)
});

export const cmykToHex = (cmyk?: CMYK): string | undefined => {
  if (!cmyk) return undefined;
  const c = clamp(cmyk.c, 0, 100) / 100;
  const m = clamp(cmyk.m, 0, 100) / 100;
  const y = clamp(cmyk.y, 0, 100) / 100;
  const k = clamp(cmyk.k, 0, 100) / 100;

  const r = Math.round(255 * (1 - c) * (1 - k));
  const g = Math.round(255 * (1 - m) * (1 - k));
  const b = Math.round(255 * (1 - y) * (1 - k));

  const toHex = (n: number) => {
    const hex = Math.max(0, Math.min(255, n)).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export const cmykToRgb = (cmyk?: CMYK): RGB | null => {
  const hex = cmykToHex(cmyk);
  return hex ? hexToRgb(hex) : null;
};

export const hexToRgb = (hex?: string): RGB | null => {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const int = parseInt(normalized.slice(1), 16);
  if (Number.isNaN(int)) return null;
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255
  };
};

export const rgbToHex = (rgb?: Partial<RGB>): string | null => {
  if (!rgb) return null;
  const normalized = normalizeRgb(rgb);
  const toHex = (value: number) => value.toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(normalized.r)}${toHex(normalized.g)}${toHex(normalized.b)}`;
};

export const hexToCmyk = (hex?: string): CMYK | null => {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const int = parseInt(normalized.slice(1), 16);
  if (Number.isNaN(int)) return null;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  const rPct = r / 255;
  const gPct = g / 255;
  const bPct = b / 255;
  const k = 1 - Math.max(rPct, gPct, bPct);
  if (k === 1) {
    return { c: 0, m: 0, y: 0, k: 100 };
  }
  const c = ((1 - rPct - k) / (1 - k)) * 100;
  const m = ((1 - gPct - k) / (1 - k)) * 100;
  const y = ((1 - bPct - k) / (1 - k)) * 100;
  return {
    c: Math.round(clamp(c, 0, 100)),
    m: Math.round(clamp(m, 0, 100)),
    y: Math.round(clamp(y, 0, 100)),
    k: Math.round(clamp(k * 100, 0, 100))
  };
};

export const rgbToCmyk = (rgb?: Partial<RGB>): CMYK | null => {
  const hex = rgbToHex(rgb);
  return hex ? hexToCmyk(hex) : null;
};

export const normalizeCmyk = (input?: Partial<CMYK>): CMYK => {
  return {
    c: clamp(Math.round(input?.c ?? 0), 0, 100),
    m: clamp(Math.round(input?.m ?? 0), 0, 100),
    y: clamp(Math.round(input?.y ?? 0), 0, 100),
    k: clamp(Math.round(input?.k ?? 0), 0, 100)
  };
};
