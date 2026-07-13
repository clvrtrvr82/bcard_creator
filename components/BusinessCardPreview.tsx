
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CardData, FieldStyle, SideLayout, CMYK, ConditionalRule, AppSettings, FontAsset } from '../types';
import { cmykToHex, hexToCmyk, normalizeCmyk } from '../utils/color';
import { CARD_HEIGHT, CARD_WIDTH } from '../cardCanvas';
import { buildCardSvg } from '../utils/vectorExport';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const dataUrlToUint8Array = (dataUrl: string) => {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

interface BusinessCardPreviewProps {
  data: CardData;
  side: SideLayout;
  scale?: number;
  showProof?: boolean;
  overlayImage?: string;
  overlayOpacity?: number;
  selectedFieldKey?: string | null;
  onFieldClick?: (key: string) => void;
  onFieldBoundsChange?: (bounds: Record<string, { top: number; left: number; width: number; height: number }>) => void;
  settings?: AppSettings;
  fontAssets?: FontAsset[];
}

const toTitleCase = (str: string) => {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
};

const measureTextWidth = (text: string, fontSize: number, fontFamily: string, fontWeight: string): number => {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    return ctx.measureText(text).width;
  } catch {
    return 0;
  }
};

const evaluateRule = (value: string, rule: ConditionalRule): boolean => {
  const val = value || '';
  switch (rule.condition) {
    case 'contains': return val.toLowerCase().includes(rule.value.toLowerCase());
    case 'equals': return val.toLowerCase() === rule.value.toLowerCase();
    case 'notEmpty': return val.trim().length > 0;
    case 'isEmpty': return val.trim().length === 0;
    case 'startsWith': return val.toLowerCase().startsWith(rule.value.toLowerCase());
    case 'longerThan': return val.length > parseInt(rule.value || '0');
    default: return false;
  }
};

const getOrderedFieldKeys = (side: SideLayout) => {
  const declaredOrder = side.fieldOrder || [];
  const existingKeys = Object.keys(side.fields || {});
  const stableDeclared = declaredOrder.filter((key, index) => declaredOrder.indexOf(key) === index && side.fields[key]);
  const missingKeys = existingKeys.filter((key) => !stableDeclared.includes(key));
  return [...stableDeclared, ...missingKeys];
};

const BusinessCardPreview = React.forwardRef<HTMLDivElement, BusinessCardPreviewProps>(({ 
  data, 
  side,
  scale = 1, 
  showProof = false, 
  overlayImage,
  overlayOpacity = 0.55,
  selectedFieldKey,
  onFieldClick,
  onFieldBoundsChange,
  settings,
  fontAssets = []
}, ref) => {
  const baseWidth = CARD_WIDTH;
  const baseHeight = CARD_HEIGHT;
  const [pdfTemplatePreviewUrl, setPdfTemplatePreviewUrl] = useState<string | null>(null);

  const resolvedBackgroundCmyk = normalizeCmyk(side.cmykBackgroundColor || hexToCmyk(side.backgroundColor) || { c: 0, m: 0, y: 0, k: 0 });
  const bgColor = cmykToHex(resolvedBackgroundCmyk) || side.backgroundColor || '#ffffff';
  useEffect(() => {
    let cancelled = false;

    const renderPdfPreview = async () => {
      if (!side.backgroundPdf) {
        if (!cancelled) setPdfTemplatePreviewUrl(null);
        return;
      }

      try {
        const loadingTask = getDocument({ data: dataUrlToUint8Array(side.backgroundPdf) });
        const pdf = await loadingTask.promise;
        const firstPage = await pdf.getPage(1);
        const baseViewport = firstPage.getViewport({ scale: 1 });
        const scale = CARD_WIDTH / baseViewport.width;
        const viewport = firstPage.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = CARD_WIDTH;
        canvas.height = CARD_HEIGHT;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas rendering context unavailable for PDF preview.');

        // Keep preview behavior consistent: template fills full card bounds.
        ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = Math.max(1, Math.round(viewport.width));
        pageCanvas.height = Math.max(1, Math.round(viewport.height));
        const pageCtx = pageCanvas.getContext('2d');
        if (!pageCtx) throw new Error('Canvas rendering context unavailable for PDF page.');

        await firstPage.render({ canvasContext: pageCtx, viewport }).promise;
        ctx.drawImage(pageCanvas, 0, 0, CARD_WIDTH, CARD_HEIGHT);

        if (!cancelled) {
          setPdfTemplatePreviewUrl(canvas.toDataURL('image/png'));
        }

        await pdf.destroy();
      } catch (error) {
        console.warn('Unable to render PDF template preview.', error);
        if (!cancelled) setPdfTemplatePreviewUrl(null);
      }
    };

    renderPdfPreview();

    return () => {
      cancelled = true;
    };
  }, [side.backgroundPdf]);

  const previewSide = useMemo(() => {
    if (side.backgroundImage || !pdfTemplatePreviewUrl) return side;
    return {
      ...side,
      backgroundImage: pdfTemplatePreviewUrl
    };
  }, [pdfTemplatePreviewUrl, side]);

  const svgMarkup = useMemo(() => buildCardSvg({ side: previewSide, data, settings, fontAssets }), [data, fontAssets, previewSide, settings]);
  const svgDataUrl = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`, [svgMarkup]);
  const showHotspots = Boolean(onFieldClick || onFieldBoundsChange || selectedFieldKey);

  const fontStyleRef = useRef<HTMLStyleElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
      return;
    }
    if (ref) {
      ref.current = node;
    }
  }, [ref]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (!fontAssets?.length) return undefined;

    const uniqueAssets = fontAssets.reduce<FontAsset[]>((acc, asset) => {
      if (!asset?.dataUrl || !asset?.name) return acc;
      if (acc.find((entry) => entry.name === asset.name)) return acc;
      acc.push(asset);
      return acc;
    }, []);

    if (!uniqueAssets.length) return undefined;

    const styleEl = document.createElement('style');
    styleEl.dataset.fontAssets = 'card-preview';
    styleEl.textContent = uniqueAssets
      .map((asset) => {
        const safeName = asset.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'UploadedFont';
        return `@font-face { font-family: '${safeName}'; src: url(${asset.dataUrl}) format('${asset.format}'); font-display: swap; font-weight: 100 900; font-style: normal italic; }`;
      })
      .join('\n');

    document.head.appendChild(styleEl);
    fontStyleRef.current = styleEl;

    return () => {
      if (fontStyleRef.current && fontStyleRef.current.parentNode) {
        fontStyleRef.current.parentNode.removeChild(fontStyleRef.current);
      }
      fontStyleRef.current = null;
    };
  }, [fontAssets]);

  useLayoutEffect(() => {
    if (!onFieldBoundsChange || !containerRef.current) return undefined;

    const frame = window.requestAnimationFrame(() => {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      const keys = getOrderedFieldKeys(side);
      const nextBounds = keys.reduce<Record<string, { top: number; left: number; width: number; height: number }>>((acc, key) => {
        const node = fieldRefs.current[key];
        if (!node) return acc;
        const rect = node.getBoundingClientRect();
        acc[key] = {
          top: Number(((rect.top - containerRect.top) / scale).toFixed(2)),
          left: Number(((rect.left - containerRect.left) / scale).toFixed(2)),
          width: Number((rect.width / scale).toFixed(2)),
          height: Number((rect.height / scale).toFixed(2))
        };
        return acc;
      }, {});

      onFieldBoundsChange(nextBounds);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [data, fontAssets, onFieldBoundsChange, scale, selectedFieldKey, settings, side]);

  const containerStyle: React.CSSProperties = {
    width: `${baseWidth}px`,
    height: `${baseHeight}px`,
    backgroundColor: bgColor,
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'hidden',
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    flexShrink: 0,
    boxShadow: showProof ? 'none' : '0 15px 30px -10px rgba(0, 0, 0, 0.15)',
    border: '1px solid #cbd5e1',
    cursor: onFieldClick ? 'crosshair' : 'default',
    backfaceVisibility: 'hidden',
    userSelect: 'none',
    borderRadius: '2px'
  };

  const formatWithPattern = (value: string, pattern: string) => {
    if (!pattern || !value) return value;
    const digits = value.replace(/\D/g, '');
    if (!digits) return value; 
    
    let formatted = '';
    let digitIndex = 0;

    for (let i = 0; i < pattern.length && digitIndex < digits.length; i++) {
      if (pattern[i] === '#') {
        formatted += digits[digitIndex] || '';
        digitIndex++;
      } else {
        formatted += pattern[i];
      }
    }
    return formatted;
  };

  const applyFormatting = (value: string, style: FieldStyle): string => {
    let result = value || '';
    
    // Pattern masking first
    if (style.pattern && result) result = formatWithPattern(result, style.pattern);

    // Char limit
    if (style.charLimit && result.length > style.charLimit) {
      result = result.substring(0, style.charLimit);
    }

    // Text transforms
    switch (style.textTransform) {
      case 'uppercase': result = result.toUpperCase(); break;
      case 'lowercase': result = result.toLowerCase(); break;
      case 'capitalize': result = result.charAt(0).toUpperCase() + result.slice(1); break;
      case 'titlecase': result = toTitleCase(result); break;
    }

    // Affixes
    if (result) {
      if (style.prefix) result = style.prefix + result;
      if (style.suffix) result = result + style.suffix;
    }

    return result;
  };

  const getFinalStyle = (baseStyle: FieldStyle, rawValue: string): FieldStyle => {
    let final = { ...baseStyle };
    if (baseStyle.conditionalRules) {
      for (const rule of baseStyle.conditionalRules) {
        if (evaluateRule(rawValue, rule)) {
          final = { ...final, ...rule.styleOverride };
        }
      }
    }
    return final;
  };

  const renderDynamicField = (key: string) => {
    const field = side.fields[key];
    if (!field) return null;

    let rawContent = '';
    
    if (key === 'address' || key === 'addressLine1') {
      rawContent = data.addressLine1 || (field.useBusinessDefault && settings ? settings.businessAddress : (field.value || ''));
    } else if (key === 'phone') {
      rawContent = data.phone || (field.useBusinessDefault && settings ? settings.businessPhone : (field.value || ''));
    } else if (key === 'email') {
      rawContent = data.email || (field.useBusinessDefault && settings ? settings.businessEmail : (field.value || ''));
    } else if (key === 'website') {
      rawContent = data.website || (field.useBusinessDefault && settings ? settings.businessWebsite : (field.value || ''));
    } else if (key in data) {
      rawContent = (data as any)[key] || field.value || '';
    } else {
      rawContent = data.customValues?.[key] || field.value || '';
    }

    const styled = getFinalStyle(field, rawContent);
    let displayContent = applyFormatting(rawContent, styled);

    // Specific logic for combined mobile on phone lines if needed
    if (key === 'phone' && !side.fields['mobile'] && data.mobile) {
      let mob = applyFormatting(data.mobile, styled);
      displayContent += `\nM: ${mob}`;
    }

    if (!displayContent) return null;

    const isSelected = selectedFieldKey === key;
    const resolvedTextCmyk = normalizeCmyk(styled.cmyk || hexToCmyk(styled.color) || { c: 0, m: 0, y: 0, k: 100 });
    const textColor = cmykToHex(resolvedTextCmyk) || styled.color || '#000000';
    
    const fieldStyle: React.CSSProperties = {
      position: 'absolute',
      top: `${styled.top}px`,
      left: `${styled.left ?? 0}px`,
      width: styled.width ? `${styled.width}px` : 'auto',
      maxWidth: styled.maxWidth ? `${styled.maxWidth}px` : undefined,
      height: styled.height ? `${styled.height}px` : undefined,
      right: 'auto',
      paddingRight: '0',
      fontSize: `${styled.fontSize}px`,
      color: 'transparent',
      fontWeight: styled.fontWeight || '400',
      fontStyle: styled.fontStyle || 'normal',
      fontFamily: styled.fontFamily || 'Inter, sans-serif',
      textAlign: styled.textAlign || 'left',
      letterSpacing: (() => {
        if (styled.charLimit && displayContent.length >= styled.charLimit) {
          const constraintWidth = styled.maxWidth || styled.width;
          if (constraintWidth) {
            const measured = measureTextWidth(displayContent, styled.fontSize, styled.fontFamily, styled.fontWeight);
            if (measured > constraintWidth) {
              const spacingAdj = (constraintWidth - measured) / Math.max(displayContent.length, 1);
              return `${spacingAdj.toFixed(2)}px`;
            }
          }
        }
        return styled.letterSpacing || 'normal';
      })(),
      lineHeight: styled.lineHeight || 1.25,
      textDecoration: styled.textDecoration || 'none',
      opacity: styled.opacity !== undefined ? styled.opacity : 1,
      outline: isSelected ? '2px dashed #3b82f6' : 'none',
      outlineOffset: '2px',
      backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
      cursor: onFieldClick ? 'pointer' : 'inherit',
      zIndex: isSelected ? 100 : (styled.zIndex || 1),
      pointerEvents: onFieldClick ? 'auto' : 'none',
      whiteSpace: 'pre-line',
      textShadow: 'none'
    };

    return (
      <div 
        key={key} 
        ref={(node) => {
          fieldRefs.current[key] = node;
        }}
        style={fieldStyle}
        onClick={(e) => {
          if (onFieldClick) {
            e.stopPropagation();
            onFieldClick(key);
          }
        }}
      >
        {displayContent}
      </div>
    );
  };

  const wrapperWidth = baseWidth * scale;
  const wrapperHeight = baseHeight * scale;

  return (
    <div 
      className="flex-shrink-0"
      style={{ 
        width: `${wrapperWidth}px`, 
        height: `${wrapperHeight}px`, 
        position: 'relative',
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    >
      <div 
        ref={setContainerRef}
        style={containerStyle}
        onClick={() => {
          if (onFieldClick) onFieldClick('');
        }}
      >
        <img
          src={svgDataUrl}
          alt="card preview"
          className="absolute inset-0 h-full w-full pointer-events-none"
          style={{ zIndex: 1 }}
        />

        {showProof && (
          <div className="absolute inset-0 flex items-center justify-center rotate-[-35deg] pointer-events-none opacity-20 z-[1000] border-4 border-slate-300">
             <span className="text-6xl font-black uppercase tracking-widest text-slate-400 border-8 border-slate-300 px-8 py-2 rounded-2xl">Proof Only</span>
          </div>
        )}

        {overlayImage && (
          <img
            src={overlayImage}
            alt="preview overlay"
            className="absolute inset-0 h-full w-full pointer-events-none"
            style={{ opacity: overlayOpacity, zIndex: 2 }}
          />
        )}
        
        {showHotspots ? getOrderedFieldKeys(side).map((key) => renderDynamicField(key)) : null}
      </div>
    </div>
  );
});

export default BusinessCardPreview;
