import { FieldStyle } from './types';

export const LEGACY_CARD_WIDTH = 400;
export const LEGACY_CARD_HEIGHT = 228.57;
export const CARD_WIDTH = 1050;
export const CARD_HEIGHT = 600;
export const CARD_DPI = 300;
export const CARD_CANVAS_VERSION = 2;
export const CARD_SCALE_FACTOR = CARD_WIDTH / LEGACY_CARD_WIDTH;
export const LEGACY_DEFAULT_FIELD_WIDTH = 220;
export const DEFAULT_FIELD_WIDTH = Number((LEGACY_DEFAULT_FIELD_WIDTH * CARD_SCALE_FACTOR).toFixed(2));
export const MIN_FIELD_HEIGHT = Number((24 * CARD_SCALE_FACTOR).toFixed(2));
export const CARD_SAFE_MARGIN = Math.round(16 * CARD_SCALE_FACTOR);

const round = (value: number) => Number(value.toFixed(2));

export const scaleLegacyValue = (value: number) => round(value * CARD_SCALE_FACTOR);
export const convertLegacyDisplayScale = (legacyScale: number) => round(legacyScale * (LEGACY_CARD_WIDTH / CARD_WIDTH));
export const pixelsToPoints = (pixels: number) => round((pixels * 72) / CARD_DPI);
export const pointsToPixels = (points: number) => round((points * CARD_DPI) / 72);

const deriveFieldBox = (field: FieldStyle, canvasWidth: number, fallbackWidth: number) => {
  const needsBoxWidth = field.width === undefined && (field.right !== undefined || field.textAlign !== 'left');
  const width = field.width ?? (needsBoxWidth ? fallbackWidth : undefined);
  let left = field.left;

  if (left === undefined && width !== undefined) {
    if (field.right !== undefined) {
      left = Math.max(0, canvasWidth - field.right - width);
    } else if (field.textAlign === 'center') {
      left = Math.max(0, (canvasWidth - width) / 2);
    }
  }

  return { left, width };
};

export const normalizeFieldStyle = (field: FieldStyle, canvasVersion?: number): FieldStyle => {
  const isLegacy = (canvasVersion ?? 1) < CARD_CANVAS_VERSION;
  const sourceCanvasWidth = isLegacy ? LEGACY_CARD_WIDTH : CARD_WIDTH;
  const fallbackWidth = isLegacy ? LEGACY_DEFAULT_FIELD_WIDTH : DEFAULT_FIELD_WIDTH;
  const { left, width } = deriveFieldBox(field, sourceCanvasWidth, fallbackWidth);

  if (isLegacy) {
    const { right, ...rest } = field;
    return {
      ...rest,
      top: scaleLegacyValue(field.top),
      left: left !== undefined ? scaleLegacyValue(left) : undefined,
      width: width !== undefined ? scaleLegacyValue(width) : undefined,
      height: field.height !== undefined ? scaleLegacyValue(field.height) : undefined,
      maxWidth: field.maxWidth !== undefined ? scaleLegacyValue(field.maxWidth) : undefined,
      fontSize: scaleLegacyValue(field.fontSize)
    };
  }

  const { right, ...rest } = field;
  return {
    ...rest,
    left,
    width
  };
};