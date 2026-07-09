import { AppSettings, CardData, CMYK, ConditionalRule, FieldStyle, FontAsset, SideLayout } from '../types';
import { cmykToHex, hexToCmyk, normalizeCmyk } from './color';
import { CARD_HEIGHT, CARD_WIDTH } from '../cardCanvas';

interface BuildCardSvgOptions {
  side: SideLayout;
  data: CardData;
  settings?: AppSettings;
  fontAssets?: FontAsset[];
}

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const toTitleCase = (value: string) => value.replace(/\w\S*/g, (chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase());

const evaluateRule = (value: string, rule: ConditionalRule): boolean => {
  const normalized = value || '';
  switch (rule.condition) {
    case 'contains': return normalized.toLowerCase().includes(rule.value.toLowerCase());
    case 'equals': return normalized.toLowerCase() === rule.value.toLowerCase();
    case 'notEmpty': return normalized.trim().length > 0;
    case 'isEmpty': return normalized.trim().length === 0;
    case 'startsWith': return normalized.toLowerCase().startsWith(rule.value.toLowerCase());
    case 'longerThan': return normalized.length > parseInt(rule.value || '0', 10);
    default: return false;
  }
};

const formatWithPattern = (value: string, pattern: string) => {
  if (!pattern || !value) return value;
  const digits = value.replace(/\D/g, '');
  if (!digits) return value;

  let formatted = '';
  let digitIndex = 0;
  for (let index = 0; index < pattern.length && digitIndex < digits.length; index += 1) {
    if (pattern[index] === '#') {
      formatted += digits[digitIndex] || '';
      digitIndex += 1;
    } else {
      formatted += pattern[index];
    }
  }
  return formatted;
};

const applyFormatting = (value: string, style: FieldStyle) => {
  let result = value || '';
  if (style.pattern && result) result = formatWithPattern(result, style.pattern);
  if (style.charLimit && result.length > style.charLimit) result = result.substring(0, style.charLimit);

  switch (style.textTransform) {
    case 'uppercase': result = result.toUpperCase(); break;
    case 'lowercase': result = result.toLowerCase(); break;
    case 'capitalize': result = result.charAt(0).toUpperCase() + result.slice(1); break;
    case 'titlecase': result = toTitleCase(result); break;
    default: break;
  }

  if (result) {
    if (style.prefix) result = style.prefix + result;
    if (style.suffix) result = result + style.suffix;
  }

  return result;
};

const getFinalStyle = (baseStyle: FieldStyle, rawValue: string): FieldStyle => {
  let finalStyle = { ...baseStyle };
  if (baseStyle.conditionalRules) {
    baseStyle.conditionalRules.forEach((rule) => {
      if (evaluateRule(rawValue, rule)) {
        finalStyle = { ...finalStyle, ...rule.styleOverride };
      }
    });
  }
  return finalStyle;
};

const getRawFieldValue = (key: string, field: FieldStyle, data: CardData, settings?: AppSettings) => {
  if (key === 'address' || key === 'addressLine1') {
    return data.addressLine1 || (field.useBusinessDefault && settings ? settings.businessAddress : (field.value || ''));
  }
  if (key === 'phone') {
    return data.phone || (field.useBusinessDefault && settings ? settings.businessPhone : (field.value || ''));
  }
  if (key === 'email') {
    return data.email || (field.useBusinessDefault && settings ? settings.businessEmail : (field.value || ''));
  }
  if (key === 'website') {
    return data.website || (field.useBusinessDefault && settings ? settings.businessWebsite : (field.value || ''));
  }
  if (key in data) {
    return (data as unknown as Record<string, string | undefined>)[key] || field.value || '';
  }
  return data.customValues?.[key] || field.value || '';
};

const formatCmykLabel = (cmyk?: CMYK) => {
  const normalized = normalizeCmyk(cmyk || { c: 0, m: 0, y: 0, k: 0 });
  return `C${normalized.c} M${normalized.m} Y${normalized.y} K${normalized.k}`;
};

const buildFontFaceCss = (fontAssets: FontAsset[]) => {
  const uniqueAssets = fontAssets.reduce<FontAsset[]>((acc, asset) => {
    if (!asset?.name || !asset?.dataUrl) return acc;
    if (acc.find((entry) => entry.name === asset.name)) return acc;
    acc.push(asset);
    return acc;
  }, []);

  return uniqueAssets.map((asset) => {
    const safeName = asset.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'UploadedFont';
    return `@font-face { font-family: '${safeName}'; src: url(${asset.dataUrl}) format('${asset.format}'); font-display: swap; font-weight: 400; font-style: normal; }`;
  }).join('\n');
};

const getOrderedFieldKeys = (side: SideLayout) => {
  const declaredOrder = side.fieldOrder || [];
  const existingKeys = Object.keys(side.fields || {});
  const stableDeclared = declaredOrder.filter((key, index) => declaredOrder.indexOf(key) === index && side.fields[key]);
  const missingKeys = existingKeys.filter((key) => !stableDeclared.includes(key));
  return [...stableDeclared, ...missingKeys];
};

export const buildCardSvg = ({ side, data, settings, fontAssets = [] }: BuildCardSvgOptions) => {
  const resolvedBackgroundCmyk = normalizeCmyk(side.cmykBackgroundColor || hexToCmyk(side.backgroundColor) || { c: 0, m: 0, y: 0, k: 0 });
  const backgroundColor = cmykToHex(resolvedBackgroundCmyk) || side.backgroundColor || '#ffffff';
  const orderedKeys = getOrderedFieldKeys(side);
  const clipDefs: string[] = [];
  const textClipBleed = 2;

  const fieldsMarkup = orderedKeys.map((key, index) => {
    const field = side.fields[key];
    if (!field) return '';

    const rawValue = getRawFieldValue(key, field, data, settings);
    const styled = getFinalStyle(field, rawValue);
    let content = applyFormatting(rawValue, styled);
    if (key === 'phone' && !side.fields.mobile && data.mobile) {
      content += `${content ? '\n' : ''}M: ${applyFormatting(data.mobile, styled)}`;
    }
    if (!content) return '';

    const resolvedTextCmyk = normalizeCmyk(styled.cmyk || hexToCmyk(styled.color) || { c: 0, m: 0, y: 0, k: 100 });
    const textColor = cmykToHex(resolvedTextCmyk) || styled.color || '#000000';
    const lineHeight = styled.fontSize * (styled.lineHeight ?? 1.25);
    const lineCount = content.split('\n').length;
    const textHeight = styled.height ?? Math.max(lineHeight * lineCount, styled.fontSize);
    const xBase = styled.left ?? 0;
    const width = styled.width ?? styled.maxWidth;
    const anchor = styled.textAlign === 'center' ? 'middle' : styled.textAlign === 'right' ? 'end' : 'start';
    const x = styled.textAlign === 'center' && width !== undefined
      ? xBase + width / 2
      : styled.textAlign === 'right' && width !== undefined
        ? xBase + width
        : xBase;
    const clipId = `clip-${index}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const clipWidth = styled.maxWidth ?? styled.width;
    if (clipWidth !== undefined) {
      const clipTop = Math.max(0, styled.top - textClipBleed);
      clipDefs.push(`<clipPath id="${clipId}"><rect x="${xBase}" y="${clipTop}" width="${clipWidth}" height="${textHeight + textClipBleed * 2}" /></clipPath>`);
    }

    const textStyle = [
      `font-family:${styled.fontFamily || 'Inter, sans-serif'}`,
      `font-size:${styled.fontSize}px`,
      `font-weight:${styled.fontWeight || '400'}`,
      `font-style:${styled.fontStyle || 'normal'}`,
      `fill:${textColor || '#000000'}`,
      `text-anchor:${anchor}`,
      'dominant-baseline:text-before-edge'
    ];
    if (styled.letterSpacing && styled.letterSpacing !== 'normal') textStyle.push(`letter-spacing:${styled.letterSpacing}`);
    if (styled.textDecoration && styled.textDecoration !== 'none') textStyle.push(`text-decoration:${styled.textDecoration}`);

    const backgroundRect = styled.backgroundColor && styled.backgroundColor !== 'transparent' && (styled.width || clipWidth)
      ? `<rect x="${xBase}" y="${styled.top}" width="${styled.width ?? clipWidth}" height="${textHeight}" fill="${styled.backgroundColor}" opacity="${styled.opacity ?? 1}" />`
      : '';

    const textNode = `<text x="${x}" y="${styled.top}" style="${escapeXml(textStyle.join(';'))}" opacity="${styled.opacity ?? 1}" data-print-cmyk="${escapeXml(formatCmykLabel(styled.cmyk))}">${content
      .split('\n')
      .map((line, lineIndex) => `<tspan x="${x}" dy="${lineIndex === 0 ? 0 : lineHeight}">${line ? escapeXml(line) : '&#160;'}</tspan>`)
      .join('')}</text>`;

    const wrappedText = clipWidth !== undefined ? `<g clip-path="url(#${clipId})">${textNode}</g>` : textNode;
    return `<g data-field-key="${escapeXml(key)}">${backgroundRect}${wrappedText}</g>`;
  }).join('');

  const defs = [buildFontFaceCss(fontAssets) ? `<style><![CDATA[${buildFontFaceCss(fontAssets)}]]></style>` : '', ...clipDefs].filter(Boolean).join('');
  const metadata = escapeXml(JSON.stringify({
    backgroundCmyk: formatCmykLabel(side.cmykBackgroundColor),
    fields: orderedKeys.map((key) => {
      const field = side.fields[key];
      return field ? {
        key,
        label: field.label || key,
        cmyk: formatCmykLabel(field.cmyk),
        fontSizePx: field.fontSize
      } : null;
    }).filter(Boolean)
  }));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="3.5in" height="2in" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <metadata>${metadata}</metadata>
  <defs>${defs}</defs>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${backgroundColor}" />
  ${side.backgroundImage ? `<image href="${side.backgroundImage}" x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" preserveAspectRatio="none" />` : ''}
  ${fieldsMarkup}
</svg>`;
};