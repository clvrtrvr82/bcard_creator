import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layout, FieldStyle, AppSettings, CardData, SideLayout, FontAsset, CMYK } from '../types';
import BusinessCardPreview from './BusinessCardPreview';
import { Eye, EyeOff, Image as ImageIcon, Plus, Trash2, ChevronUp, ChevronDown, Tag, X, Copy } from 'lucide-react';
import { cmykToHex, hexToCmyk, normalizeCmyk } from '../utils/color';
import { CARD_HEIGHT, CARD_SAFE_MARGIN, CARD_WIDTH, DEFAULT_FIELD_WIDTH, MIN_FIELD_HEIGHT, convertLegacyDisplayScale, pixelsToPoints, pointsToPixels, scaleLegacyValue } from '../cardCanvas';

const CARD_FRAME_PADDING = 16;
const DEFAULT_CANVAS_SCALE = convertLegacyDisplayScale(1.3);
const DEFAULT_FIELD_EDITOR_ZOOM = 1;
const MAX_FIELD_EDITOR_ZOOM = 3;
const POSITION_STEPS = [1, 2, 4, 8].map((stepInPoints) => ({
  points: stepInPoints,
  pixels: pointsToPixels(stepInPoints)
}));
const HORIZONTAL_ALIGNMENT_OPTIONS = [
  { label: 'Left', value: 'left' },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'right' }
] as const;
const TEXT_CASE_OPTIONS = [
  { label: 'Normal', value: 'none' },
  { label: 'Uppercase', value: 'uppercase' },
  { label: 'Capitalize', value: 'capitalize' },
  { label: 'Lowercase', value: 'lowercase' }
] as const;

interface LayoutEditorProps {
  layout: Layout;
  onChange: (layout: Layout) => void;
  settings: AppSettings;
  onOpenAssets?: () => void;
}

interface ShopifyProductSummary {
  title: string;
  handle: string;
  tags: string[];
}

const SHOPIFY_PRODUCT_PAGE_SIZE = 24;

const cloneLayout = (layout: Layout): Layout => JSON.parse(JSON.stringify(layout));
const normalizeShopifyToken = (value: string) => value.trim().toLowerCase();

const createFieldTemplate = (label: string): FieldStyle => ({
  label,
  top: scaleLegacyValue(80),
  left: scaleLegacyValue(40),
  width: DEFAULT_FIELD_WIDTH,
  fontSize: scaleLegacyValue(14),
  color: '#0f172a',
  fontWeight: '600',
  fontFamily: "'Inter', sans-serif",
  textAlign: 'left',
  showInForm: true
});

const createBackTemplate = (): SideLayout => ({
  backgroundColor: '#0f172a',
  fields: {
    backText: {
      label: 'Back Text',
      value: 'Your Brand',
      top: scaleLegacyValue(100),
      left: scaleLegacyValue(90),
      width: DEFAULT_FIELD_WIDTH,
      fontSize: scaleLegacyValue(18),
      color: '#ffffff',
      fontWeight: '700',
      fontFamily: "'Inter', sans-serif",
      textAlign: 'center',
      showInForm: false
    }
  },
  fieldOrder: ['backText']
});

const builtInFonts = [
  { label: 'Inter', value: "'Inter', sans-serif" },
  { label: 'Montserrat', value: "'Montserrat', sans-serif" },
  { label: 'Playfair Display', value: "'Playfair Display', serif" },
  { label: 'IBM Plex Sans', value: "'IBM Plex Sans', sans-serif" },
  { label: 'Neue Montreal', value: "'Neue Montreal', sans-serif" }
];

const weightOptions = [
  { label: 'Hairline', value: '100' },
  { label: 'Thin', value: '200' },
  { label: 'Light', value: '300' },
  { label: 'Regular', value: '400' },
  { label: 'Medium', value: '500' },
  { label: 'Semibold', value: '600' },
  { label: 'Bold', value: '700' },
  { label: 'Extra Bold', value: '800' },
  { label: 'Black', value: '900' }
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const cmykEquals = (left: CMYK, right: CMYK) => {
  const normalizedLeft = normalizeCmyk(left);
  const normalizedRight = normalizeCmyk(right);
  return normalizedLeft.c === normalizedRight.c
    && normalizedLeft.m === normalizedRight.m
    && normalizedLeft.y === normalizedRight.y
    && normalizedLeft.k === normalizedRight.k;
};
const formatCmykLabel = (cmyk?: CMYK | null) => {
  if (!cmyk) return 'CMYK unavailable';
  const normalized = normalizeCmyk(cmyk);
  return `C${normalized.c} M${normalized.m} Y${normalized.y} K${normalized.k}`;
};
const formatColorPresetLabel = (preset: { name?: string; pantone?: string; cmyk: CMYK }) => preset.name || preset.pantone || formatCmykLabel(preset.cmyk);

const maskPresets = [
  { id: 'none', label: 'No Mask', pattern: '' },
  { id: 'na-phone', label: 'North America Phone', pattern: '(###) ###-####' },
  { id: 'intl-phone', label: 'International Phone', pattern: '+## (###) ### ####' },
  { id: 'dotted-phone', label: 'Dotted Phone', pattern: '###.###.####' },
  { id: 'extension', label: 'Phone + Ext', pattern: '(###) ###-#### x####' },
  { id: 'room', label: 'Room Number', pattern: '###-##' }
];

const LayoutEditor: React.FC<LayoutEditorProps> = ({ layout, onChange, settings, onOpenAssets }) => {
  const [activeSide, setActiveSide] = useState<'front' | 'back'>('front');
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [selectedFieldKeys, setSelectedFieldKeys] = useState<string[]>([]);
  const [newFieldName, setNewFieldName] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [shopifyProducts, setShopifyProducts] = useState<ShopifyProductSummary[]>([]);
  const [productRequestCursor, setProductRequestCursor] = useState<string | null>(null);
  const [nextProductListCursor, setNextProductListCursor] = useState<string | null>(null);
  const [hasMoreShopifyProducts, setHasMoreShopifyProducts] = useState(false);
  const [productPickerStatus, setProductPickerStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'unavailable'>('idle');
  const [canvasScale, setCanvasScale] = useState(DEFAULT_CANVAS_SCALE);
  const [positionStep, setPositionStep] = useState(() => pointsToPixels(1));
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showAdvancedControls, setShowAdvancedControls] = useState(false);
  const [showFieldEditorModal, setShowFieldEditorModal] = useState(false);
  const [fieldEditorSection, setFieldEditorSection] = useState<'placement' | 'style'>('placement');
  const [showPlacementDetails, setShowPlacementDetails] = useState(false);
  const [showStyleAdvanced, setShowStyleAdvanced] = useState(false);
  const [showPreviewOverlay, setShowPreviewOverlay] = useState(false);
  const [previewOverlayOpacity, setPreviewOverlayOpacity] = useState(0.55);
  const [fieldBounds, setFieldBounds] = useState<Record<string, { top: number; left: number; width: number; height: number }>>({});
  const [fieldEditorZoom, setFieldEditorZoom] = useState(DEFAULT_FIELD_EDITOR_ZOOM);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const fieldEditorPreviewRef = useRef<HTMLDivElement>(null);
  const templateImageInputRef = useRef<HTMLInputElement>(null);
  const previewImageInputRef = useRef<HTMLInputElement>(null);
  const [fitCanvasScale, setFitCanvasScale] = useState(DEFAULT_CANVAS_SCALE);
  const [fitFieldEditorPreviewScale, setFitFieldEditorPreviewScale] = useState(DEFAULT_CANVAS_SCALE);
  const pushMessage = (text: string) => console.info(text);
  const pushError = (text: string) => console.warn(text);

  useEffect(() => {
    setSelectedFieldKey(null);
    setSelectedFieldKeys([]);
    setActiveSide('front');
  }, [layout.id]);

  useEffect(() => {
    setProductRequestCursor(null);
    setNextProductListCursor(null);
    setHasMoreShopifyProducts(false);
    setShopifyProducts([]);
  }, [productSearch]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setProductPickerStatus('loading');
      try {
        const params = new URLSearchParams();
        params.set('limit', String(SHOPIFY_PRODUCT_PAGE_SIZE));
        if (productSearch.trim()) {
          params.set('query', productSearch.trim());
        }
        if (productRequestCursor) {
          params.set('cursor', productRequestCursor);
        }

        const response = await fetch(`/api/shopify-products?${params.toString()}`, {
          credentials: 'include',
          signal: controller.signal
        });

        if (cancelled) return;

        if (response.status === 501 || response.status === 404) {
          setShopifyProducts([]);
          setProductPickerStatus('unavailable');
          return;
        }

        if (!response.ok) {
          throw new Error(`Unable to load Shopify products: ${response.status}`);
        }

        const payload = await response.json();
        if (cancelled) return;

        const nextProducts = Array.isArray(payload?.products) ? payload.products : [];
        setShopifyProducts((prev) => {
          if (!productRequestCursor) {
            return nextProducts;
          }

          const merged = new Map(prev.map((product) => [product.handle, product]));
          nextProducts.forEach((product) => {
            if (product?.handle) {
              merged.set(product.handle, product);
            }
          });
          return Array.from(merged.values());
        });
        setHasMoreShopifyProducts(Boolean(payload?.hasNextPage));
        setNextProductListCursor(payload?.nextCursor || null);
        setProductPickerStatus('ready');
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.warn('Unable to load Shopify product list.', error);
        setShopifyProducts([]);
        setNextProductListCursor(null);
        setHasMoreShopifyProducts(false);
        setProductPickerStatus('error');
      }
    }, 250);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [productRequestCursor, productSearch]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateScale = () => {
      const canvasViewportWidth = canvasViewportRef.current?.clientWidth ?? 0;
      const cardFrameWidth = CARD_WIDTH + CARD_FRAME_PADDING * 2;
      if (canvasViewportWidth > 0) {
        const nextFitScale = clamp((canvasViewportWidth - CARD_FRAME_PADDING * 2) / cardFrameWidth, 0.3, DEFAULT_CANVAS_SCALE);
        setFitCanvasScale(Number(nextFitScale.toFixed(3)));
      }

      const fieldEditorPreviewWidth = fieldEditorPreviewRef.current?.clientWidth ?? 0;
      const previewFrameWidth = CARD_WIDTH + CARD_FRAME_PADDING * 2;
      if (fieldEditorPreviewWidth > 0) {
        const nextPreviewScale = clamp((fieldEditorPreviewWidth - 16) / previewFrameWidth, 0.3, 1);
        setFitFieldEditorPreviewScale(Number(nextPreviewScale.toFixed(3)));
      }
    };

    updateScale();
    const observer = new ResizeObserver(() => updateScale());
    if (canvasViewportRef.current) observer.observe(canvasViewportRef.current);
    if (fieldEditorPreviewRef.current) observer.observe(fieldEditorPreviewRef.current);
    window.addEventListener('resize', updateScale);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [showFieldEditorModal]);

  const sideLayout = activeSide === 'back' && layout.back ? layout.back : layout.front;
  const fieldOrder = sideLayout.fieldOrder?.length ? sideLayout.fieldOrder : Object.keys(sideLayout.fields);
  const layoutFieldEntries = useMemo(() => {
    const fieldMap = new Map<string, { key: string; label: string; sides: Array<'front' | 'back'> }>();
    ([['front', layout.front], ['back', layout.back]] as const).forEach(([sideName, currentSide]) => {
      if (!currentSide) return;
      const keys = currentSide.fieldOrder?.length ? currentSide.fieldOrder : Object.keys(currentSide.fields);
      keys.forEach((key) => {
        const existing = fieldMap.get(key);
        const label = currentSide.fields[key]?.label || key;
        if (existing) {
          if (!existing.sides.includes(sideName)) existing.sides.push(sideName);
          return;
        }
        fieldMap.set(key, { key, label, sides: [sideName] });
      });
    });
    return Array.from(fieldMap.values());
  }, [layout.back, layout.front]);

  const previewCard: CardData = useMemo(() => {
    const preview: CardData = {
      name: '',
      jobTitle: '',
      email: '',
      phone: '',
      mobile: '',
      addressLine1: '',
      website: '',
      brand: layout.brand,
      layoutId: layout.id,
      customValues: {}
    };

    const knownKeys = new Set(['name', 'jobTitle', 'email', 'phone', 'mobile', 'addressLine1', 'address', 'website']);
    const sides = [layout.front, layout.back].filter(Boolean) as SideLayout[];

    sides.forEach((currentSide) => {
      Object.entries(currentSide.fields).forEach(([key, field]) => {
        const fieldValue = field.value || '';
        const fallbackBusinessValue = field.useBusinessDefault
          ? key === 'email'
            ? settings.businessEmail
            : key === 'phone'
              ? settings.businessPhone
              : key === 'website'
                ? settings.businessWebsite
                : key === 'address' || key === 'addressLine1'
                  ? settings.businessAddress
                  : ''
          : '';
        const resolvedValue = fieldValue || fallbackBusinessValue;

        if (key === 'address') {
          preview.addressLine1 = resolvedValue;
          return;
        }

        if (knownKeys.has(key)) {
          (preview as any)[key] = resolvedValue;
          return;
        }

        if (resolvedValue) {
          preview.customValues[key] = resolvedValue;
        }
      });
    });

    return preview;
  }, [layout.back, layout.brand, layout.front, layout.id, settings.businessAddress, settings.businessEmail, settings.businessPhone, settings.businessWebsite]);

  const fontChoices = useMemo(() => {
    const uploadedFonts = (layout.fontAssets || []).map((asset) => ({ label: asset.name, value: asset.name }));
    const customFonts = (layout.customFonts || []).map((font) => ({ label: font, value: font }));
    const merged = [...builtInFonts];
    [...uploadedFonts, ...customFonts].forEach((option) => {
      if (!merged.find((existing) => existing.value === option.value)) {
        merged.push(option);
      }
    });
    return merged;
  }, [layout.customFonts, layout.fontAssets]);
  const colorPresets = layout.colorPresets || [];
  const activeSelectedFieldKeys = useMemo(() => {
    const keys = selectedFieldKeys.filter((key) => Boolean(sideLayout.fields[key]));
    if (keys.length) return keys;
    return selectedFieldKey && sideLayout.fields[selectedFieldKey] ? [selectedFieldKey] : [];
  }, [selectedFieldKey, selectedFieldKeys, sideLayout.fields]);

  const getFieldMetrics = (key: string, field: FieldStyle) => {
    const measured = fieldBounds[key];
    return {
      width: measured?.width ?? field.width ?? 220,
      height: measured?.height ?? field.height ?? Math.max(field.fontSize * (field.lineHeight ?? 1.25) * 1.2, MIN_FIELD_HEIGHT)
    };
  };

  const normalizePositionValue = (value: number, max: number) => {
    const clamped = clamp(value, 0, max);
    const snapped = snapToGrid ? Math.round(clamped / positionStep) * positionStep : clamped;
    return Number(clamp(snapped, 0, max).toFixed(2));
  };

  const commitLayout = (mutator: (draft: Layout) => void) => {
    const draft = cloneLayout(layout);
    mutator(draft);
    onChange(draft);
  };

  const setSingleSelection = (key: string | null) => {
    setSelectedFieldKey(key);
    setSelectedFieldKeys(key ? [key] : []);
  };

  const handleFieldSelection = (key: string | null, options?: { additive?: boolean; preferredSide?: 'front' | 'back' }) => {
    if (options?.preferredSide) {
      setActiveSide(options.preferredSide);
    }
    if (!key) {
      setSingleSelection(null);
      return;
    }
    if (!options?.additive) {
      setSingleSelection(key);
      return;
    }
    setSelectedFieldKeys((prev) => {
      if (prev.includes(key)) {
        const next = prev.filter((entry) => entry !== key);
        setSelectedFieldKey((current) => (current === key ? next[0] ?? null : current));
        return next;
      }
      const next = [...prev, key];
      setSelectedFieldKey(key);
      return next;
    });
  };

  const commitSelectedFields = (keys: string[], mutator: (field: FieldStyle, key: string) => void) => {
    if (!keys.length) return;
    commitLayout((draft) => {
      const targetSide = activeSide === 'back' ? draft.back ?? draft.front : draft.front;
      if (!targetSide) return;
      keys.forEach((key) => {
        const targetField = targetSide.fields[key];
        if (!targetField) return;
        mutator(targetField, key);
      });
    });
  };

  const handleFieldDragStart = (key: string, event: React.PointerEvent<HTMLButtonElement>, previewScale: number) => {
    event.preventDefault();
    event.stopPropagation();
    const field = sideLayout.fields[key];
    if (!field) return;

    const dragKeys = activeSelectedFieldKeys.includes(key) ? activeSelectedFieldKeys : [key];
    if (!activeSelectedFieldKeys.includes(key)) {
      setSingleSelection(key);
    }
    const originX = event.clientX;
    const originY = event.clientY;
    const startPositions = dragKeys.reduce<Record<string, { left: number; top: number; width: number; height: number }>>((acc, fieldKey) => {
      const sourceField = sideLayout.fields[fieldKey];
      if (!sourceField) return acc;
      const metrics = getFieldMetrics(fieldKey, sourceField);
      acc[fieldKey] = {
        left: sourceField.left ?? 0,
        top: sourceField.top ?? 0,
        width: metrics.width,
        height: metrics.height
      };
      return acc;
    }, {});

    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const deltaX = (moveEvent.clientX - originX) / previewScale;
      const deltaY = (moveEvent.clientY - originY) / previewScale;
      commitSelectedFields(dragKeys, (targetField, fieldKey) => {
        const startPosition = startPositions[fieldKey];
        if (!startPosition) return;
        const nextLeft = normalizePositionValue(startPosition.left + deltaX, CARD_WIDTH - startPosition.width);
        const nextTop = normalizePositionValue(startPosition.top + deltaY, CARD_HEIGHT - startPosition.height);
        targetField.left = nextLeft;
        targetField.top = nextTop;
        delete targetField.right;
      });
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const handleFieldPositionChange = (key: string, axis: 'left' | 'top', value: number) => {
    if (!key || Number.isNaN(value)) return;
    commitLayout((draft) => {
      const targetSide = activeSide === 'back' ? draft.back ?? draft.front : draft.front;
      if (!targetSide) return;
      const targetField = targetSide.fields[key];
      if (!targetField) return;
      const { width, height } = getFieldMetrics(key, targetField);
      const maxLeft = CARD_WIDTH - width;
      const maxTop = CARD_HEIGHT - height;
      const max = axis === 'left' ? maxLeft : maxTop;
      (targetField as any)[axis] = normalizePositionValue(value, max);
      if (axis === 'left') delete targetField.right;
    });
  };

  const handleNudgeField = (key: string, axis: 'left' | 'top', vdelta: number) => {
    const targetKeys = activeSelectedFieldKeys.length ? activeSelectedFieldKeys : key ? [key] : [];
    if (!targetKeys.length) return;
    commitSelectedFields(targetKeys, (targetField, fieldKey) => {
      const currentField = sideLayout.fields[fieldKey];
      if (!currentField) return;
      const metrics = getFieldMetrics(fieldKey, currentField);
      const baseline = axis === 'left' ? targetField.left ?? 0 : targetField.top ?? 0;
      const max = axis === 'left' ? CARD_WIDTH - metrics.width : CARD_HEIGHT - metrics.height;
      (targetField as any)[axis] = normalizePositionValue(baseline + delta, max);
      if (axis === 'left') delete targetField.right;
    });
  };

  const handleAlignField = (key: string, mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'safe-left' | 'safe-right' | 'safe-top' | 'safe-bottom') => {
    const targetKeys = activeSelectedFieldKeys.length ? activeSelectedFieldKeys : [key];
    commitSelectedFields(targetKeys, (targetField, fieldKey) => {
      const currentField = sideLayout.fields[fieldKey];
      if (!currentField) return;
      const { width, height } = getFieldMetrics(fieldKey, currentField);
      let nextLeft = targetField.left ?? 0;
      let nextTop = targetField.top ?? 0;

      const groupFrames = targetKeys
        .map((fieldKey) => {
          const currentField = sideLayout.fields[fieldKey];
          if (!currentField) return null;
          const metrics = getFieldMetrics(fieldKey, currentField);
          return {
            key: fieldKey,
            left: currentField.left ?? 0,
            top: currentField.top ?? 0,
            width: metrics.width,
            height: metrics.height,
            right: (currentField.left ?? 0) + metrics.width,
            bottom: (currentField.top ?? 0) + metrics.height,
            centerX: (currentField.left ?? 0) + metrics.width / 2,
            centerY: (currentField.top ?? 0) + metrics.height / 2
          };
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value));

      const groupBounds = groupFrames.length > 1 ? {
        left: Math.min(...groupFrames.map((frame) => frame.left)),
        right: Math.max(...groupFrames.map((frame) => frame.right)),
        top: Math.min(...groupFrames.map((frame) => frame.top)),
        bottom: Math.max(...groupFrames.map((frame) => frame.bottom)),
        centerX: groupFrames.reduce((sum, frame) => sum + frame.centerX, 0) / groupFrames.length,
        centerY: groupFrames.reduce((sum, frame) => sum + frame.centerY, 0) / groupFrames.length
      } : null;

      if (groupBounds) {
        if (mode === 'left') nextLeft = groupBounds.left;
        if (mode === 'center') nextLeft = groupBounds.centerX - width / 2;
        if (mode === 'right') nextLeft = groupBounds.right - width;
        if (mode === 'top') nextTop = groupBounds.top;
        if (mode === 'middle') nextTop = groupBounds.centerY - height / 2;
        if (mode === 'bottom') nextTop = groupBounds.bottom - height;
        if (mode === 'safe-left') nextLeft = groupFrames.find((frame) => frame.key === fieldKey)?.left + (CARD_SAFE_MARGIN - groupBounds.left);
        if (mode === 'safe-right') nextLeft = groupFrames.find((frame) => frame.key === fieldKey)?.left + ((CARD_WIDTH - CARD_SAFE_MARGIN - groupBounds.right));
        if (mode === 'safe-top') nextTop = groupFrames.find((frame) => frame.key === fieldKey)?.top + (CARD_SAFE_MARGIN - groupBounds.top);
        if (mode === 'safe-bottom') nextTop = groupFrames.find((frame) => frame.key === fieldKey)?.top + ((CARD_HEIGHT - CARD_SAFE_MARGIN - groupBounds.bottom));
      } else {
        if (mode === 'left') nextLeft = 0;
        if (mode === 'center') nextLeft = (CARD_WIDTH - width) / 2;
        if (mode === 'right') nextLeft = CARD_WIDTH - width;
        if (mode === 'top') nextTop = 0;
        if (mode === 'middle') nextTop = (CARD_HEIGHT - height) / 2;
        if (mode === 'bottom') nextTop = CARD_HEIGHT - height;
        if (mode === 'safe-left') nextLeft = CARD_SAFE_MARGIN;
        if (mode === 'safe-right') nextLeft = CARD_WIDTH - width - CARD_SAFE_MARGIN;
        if (mode === 'safe-top') nextTop = CARD_SAFE_MARGIN;
        if (mode === 'safe-bottom') nextTop = CARD_HEIGHT - height - CARD_SAFE_MARGIN;
      }

      targetField.left = normalizePositionValue(nextLeft, CARD_WIDTH - width);
      targetField.top = normalizePositionValue(nextTop, CARD_HEIGHT - height);
      delete targetField.right;
    });
  };

  const handleAutoFitWidth = (key: string) => {
    const currentField = sideLayout.fields[key];
    if (!currentField) return;
    const measured = fieldBounds[key];
    if (!measured) return;
    commitLayout((draft) => {
      const targetSide = activeSide === 'back' ? draft.back ?? draft.front : draft.front;
      if (!targetSide) return;
      const targetField = targetSide.fields[key];
      if (!targetField) return;
      targetField.width = Math.ceil(measured.width);
      targetField.height = Math.ceil(measured.height);
    });
  };

  const handleResetFieldBox = (key: string) => {
    commitLayout((draft) => {
      const targetSide = activeSide === 'back' ? draft.back ?? draft.front : draft.front;
      if (!targetSide) return;
      const targetField = targetSide.fields[key];
      if (!targetField) return;
      targetField.height = undefined;
      targetField.maxWidth = undefined;
      delete targetField.right;
    });
  };

  const handleFieldValueChange = (key: string, prop: keyof FieldStyle, value: string | number | boolean) => {
    commitLayout((draft) => {
      const targetSide = activeSide === 'back' ? draft.back ?? draft.front : draft.front;
      if (!targetSide) return;
      const targetField = targetSide.fields[key];
      if (!targetField) return;
      (targetField as any)[prop] = value;
    });
  };

  const handleDeleteField = (key: string) => {
    commitLayout((draft) => {
      const targetSide = activeSide === 'back' ? draft.back ?? draft.front : draft.front;
      if (!targetSide) return;
      delete targetSide.fields[key];
      targetSide.fieldOrder = targetSide.fieldOrder.filter((entry) => entry !== key);
    });
    setSelectedFieldKey(null);
    setSelectedFieldKeys([]);
  };

  const handleDuplicateField = (key: string) => {
    const sourceField = sideLayout.fields[key];
    if (!sourceField) return;

    const sourceLabel = sourceField.label || key;
    const normalizedBaseKey = key.replace(/_copy\d*$/i, '');
    let counter = 1;
    let nextKey = `${normalizedBaseKey}_copy`;
    while (sideLayout.fields[nextKey]) {
      counter += 1;
      nextKey = `${normalizedBaseKey}_copy${counter}`;
    }

    commitLayout((draft) => {
      const targetSide = activeSide === 'back' ? draft.back ?? draft.front : draft.front;
      if (!targetSide) return;
      targetSide.fields[nextKey] = {
        ...JSON.parse(JSON.stringify(sourceField)),
        label: `${sourceLabel} Copy`,
        left: normalizePositionValue((sourceField.left ?? 0) + positionStep * 2, CARD_WIDTH - (sourceField.width ?? 220)),
        top: normalizePositionValue((sourceField.top ?? 0) + positionStep * 2, CARD_HEIGHT - (sourceField.height ?? Math.max(sourceField.fontSize * (sourceField.lineHeight ?? 1.25) * 1.2, MIN_FIELD_HEIGHT)))
      };
      const sourceIndex = targetSide.fieldOrder.indexOf(key);
      const nextOrder = [...targetSide.fieldOrder];
      nextOrder.splice(sourceIndex + 1, 0, nextKey);
      targetSide.fieldOrder = nextOrder;
    });

    setSingleSelection(nextKey);
  };

  const handleAddField = () => {
    const trimmed = newFieldName.trim();
    if (!trimmed) return;
    const baseKey = trimmed.toLowerCase().replace(/[^a-z0-9]+/gi, '_') || 'field';
    let key = baseKey;
    let suffix = 2;
    while (sideLayout.fields[key]) {
      key = `${baseKey}_${suffix}`;
      suffix += 1;
    }
    commitLayout((draft) => {
      const targetSide = activeSide === 'back' ? draft.back ?? draft.front : draft.front;
      if (!targetSide) return;
      targetSide.fields[key] = createFieldTemplate(trimmed);
      targetSide.fieldOrder = [...targetSide.fieldOrder, key];
    });
    setNewFieldName('');
    openFieldEditor(key, { section: 'style' });
  };

  const handleReorderField = (key: string, direction: 'up' | 'down') => {
    commitLayout((draft) => {
      const targetSide = activeSide === 'back' ? draft.back ?? draft.front : draft.front;
      if (!targetSide) return;
      const order = [...targetSide.fieldOrder];
      const index = order.indexOf(key);
      if (index === -1) return;
      const nextIndex = direction === 'up' ? Math.max(index - 1, 0) : Math.min(index + 1, order.length - 1);
      order.splice(index, 1);
      order.splice(nextIndex, 0, key);
      targetSide.fieldOrder = order;
    });
  };

  const handleBackgroundUpload = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      commitLayout((draft) => {
        const targetSide = activeSide === 'back' ? draft.back ?? draft.front : draft.front;
        if (!targetSide) return;
        targetSide.backgroundImage = reader.result as string;
        targetSide.backgroundImageName = file.name;
      });
      if (templateImageInputRef.current) {
        templateImageInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveBackgroundImage = () => {
    commitLayout((draft) => {
      const targetSide = activeSide === 'back' ? draft.back ?? draft.front : draft.front;
      if (!targetSide) return;
      delete targetSide.backgroundImage;
      delete targetSide.backgroundImageName;
    });
    if (templateImageInputRef.current) {
      templateImageInputRef.current.value = '';
    }
  };

  const handlePreviewUpload = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      commitLayout((draft) => {
        draft.previewImage = reader.result as string;
        draft.previewImageName = file.name;
      });
      if (previewImageInputRef.current) {
        previewImageInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePreviewImage = () => {
    commitLayout((draft) => {
      delete draft.previewImage;
      delete draft.previewImageName;
    });
    if (previewImageInputRef.current) {
      previewImageInputRef.current.value = '';
    }
  };

  const handleAddTag = () => {
    const cleaned = tagInput.trim().toLowerCase();
    if (!cleaned) return;
    commitLayout((draft) => {
      const nextTags = new Set(draft.shopifyTags || []);
      nextTags.add(cleaned);
      draft.shopifyTags = Array.from(nextTags);
    });
    setTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    commitLayout((draft) => {
      draft.shopifyTags = (draft.shopifyTags || []).filter((entry) => entry !== tag);
    });
  };

  const handleApplyShopifyProduct = (product: ShopifyProductSummary) => {
    const normalizedTags = product.tags.map(normalizeShopifyToken).filter(Boolean);

    commitLayout((draft) => {
      draft.shopifyProductHandle = product.handle;
      draft.shopifyTags = Array.from(new Set(normalizedTags));
    });

    pushMessage(`Linked layout to Shopify product ${product.title}.`);
  };

  const handleClearShopifyProduct = () => {
    commitLayout((draft) => {
      draft.shopifyProductHandle = '';
    });

    pushMessage('Shopify product link cleared.');
  };

  const handleLoadMoreProducts = () => {
    if (!hasMoreShopifyProducts || productPickerStatus === 'loading') return;
    setProductRequestCursor(nextProductListCursor);
  };

  const getSelectionFrames = (keys: string[]) => keys
    .map((key) => {
      const currentField = sideLayout.fields[key];
      if (!currentField) return null;
      const metrics = getFieldMetrics(key, currentField);
      const left = currentField.left ?? 0;
      const top = currentField.top ?? 0;
      return {
        key,
        left,
        top,
        width: metrics.width,
        height: metrics.height,
        right: left + metrics.width,
        bottom: top + metrics.height
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  const handleAlignSelection = (mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (activeSelectedFieldKeys.length < 2) return;
    const selectionFrames = getSelectionFrames(activeSelectedFieldKeys);
    if (selectionFrames.length < 2) return;

    const selectionBounds = {
      left: Math.min(...selectionFrames.map((frame) => frame.left)),
      right: Math.max(...selectionFrames.map((frame) => frame.right)),
      top: Math.min(...selectionFrames.map((frame) => frame.top)),
      bottom: Math.max(...selectionFrames.map((frame) => frame.bottom))
    };
    const centerX = (selectionBounds.left + selectionBounds.right) / 2;
    const centerY = (selectionBounds.top + selectionBounds.bottom) / 2;

    commitSelectedFields(activeSelectedFieldKeys, (targetField, fieldKey) => {
      const currentField = sideLayout.fields[fieldKey];
      if (!currentField) return;
      const metrics = getFieldMetrics(fieldKey, currentField);

      if (mode === 'left') targetField.left = normalizePositionValue(selectionBounds.left, CARD_WIDTH - metrics.width);
      if (mode === 'center') targetField.left = normalizePositionValue(centerX - metrics.width / 2, CARD_WIDTH - metrics.width);
      if (mode === 'right') targetField.left = normalizePositionValue(selectionBounds.right - metrics.width, CARD_WIDTH - metrics.width);
      if (mode === 'top') targetField.top = normalizePositionValue(selectionBounds.top, CARD_HEIGHT - metrics.height);
      if (mode === 'middle') targetField.top = normalizePositionValue(centerY - metrics.height / 2, CARD_HEIGHT - metrics.height);
      if (mode === 'bottom') targetField.top = normalizePositionValue(selectionBounds.bottom - metrics.height, CARD_HEIGHT - metrics.height);
      delete targetField.right;
    });
  };

  const handleMaskPresetChange = (presetId: string) => {
    if (!selectedFieldKey) return;
    if (presetId === 'custom') return;
    const preset = maskPresets.find((entry) => entry.id === presetId);
    handleFieldValueChange(selectedFieldKey, 'pattern', preset?.pattern || '');
  };

  const applyCmykToField = (key: string, swatch: CMYK) => {
    commitLayout((draft) => {
      const targetSide = activeSide === 'back' ? draft.back ?? draft.front : draft.front;
      if (!targetSide) return;
      const targetField = targetSide.fields[key];
      if (!targetField) return;
      const normalized = normalizeCmyk(swatch);
      targetField.cmyk = normalized;
      targetField.color = cmykToHex(normalized) || targetField.color;
    });
  };

  const handleAlignFieldsToPrimary = (mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (!selectedFieldKey || activeSelectedFieldKeys.length < 2) return;
    const anchorField = sideLayout.fields[selectedFieldKey];
    if (!anchorField) return;
    const anchorMetrics = getFieldMetrics(selectedFieldKey, anchorField);
    const anchorLeft = anchorField.left ?? 0;
    const anchorTop = anchorField.top ?? 0;
    const anchorCenterX = anchorLeft + anchorMetrics.width / 2;
    const anchorCenterY = anchorTop + anchorMetrics.height / 2;
    const anchorRight = anchorLeft + anchorMetrics.width;
    const anchorBottom = anchorTop + anchorMetrics.height;

    commitSelectedFields(activeSelectedFieldKeys.filter((key) => key !== selectedFieldKey), (targetField, fieldKey) => {
      const currentField = sideLayout.fields[fieldKey];
      if (!currentField) return;
      const metrics = getFieldMetrics(fieldKey, currentField);
      if (mode === 'left') targetField.left = normalizePositionValue(anchorLeft, CARD_WIDTH - metrics.width);
      if (mode === 'center') targetField.left = normalizePositionValue(anchorCenterX - metrics.width / 2, CARD_WIDTH - metrics.width);
      if (mode === 'right') targetField.left = normalizePositionValue(anchorRight - metrics.width, CARD_WIDTH - metrics.width);
      if (mode === 'top') targetField.top = normalizePositionValue(anchorTop, CARD_HEIGHT - metrics.height);
      if (mode === 'middle') targetField.top = normalizePositionValue(anchorCenterY - metrics.height / 2, CARD_HEIGHT - metrics.height);
      if (mode === 'bottom') targetField.top = normalizePositionValue(anchorBottom - metrics.height, CARD_HEIGHT - metrics.height);
      delete targetField.right;
    });
  };

  const selectedField = selectedFieldKey ? sideLayout.fields[selectedFieldKey] : null;
  const currentTemplateImageName = sideLayout.backgroundImageName || 'Current template image';
  const currentPreviewImageName = layout.previewImageName || 'Current preview image';
  const selectedMaskPresetId = useMemo(() => {
    if (!selectedField?.pattern) return 'none';
    const match = maskPresets.find((preset) => preset.pattern === selectedField.pattern);
    return match ? match.id : 'custom';
  }, [selectedField?.pattern]);
  const selectedFieldCmyk = selectedField ? normalizeCmyk(selectedField.cmyk || hexToCmyk(selectedField.color) || { c: 0, m: 0, y: 0, k: 0 }) : null;
  const selectedFieldPointSize = selectedField ? pixelsToPoints(selectedField.fontSize) : null;
  const selectedFieldColorPresetId = useMemo(() => {
    if (!selectedFieldCmyk) return '';
    return colorPresets.find((preset) => cmykEquals(preset.cmyk, selectedFieldCmyk))?.id || '';
  }, [colorPresets, selectedFieldCmyk]);
  const placementPreviewData = useMemo(() => {
    if (!selectedFieldKey || !selectedField) return previewCard;

    const previewText = selectedField.label || selectedFieldKey;
    const nextPreview: CardData = {
      name: '',
      jobTitle: '',
      email: '',
      phone: '',
      mobile: '',
      addressLine1: '',
      website: '',
      brand: layout.brand,
      layoutId: layout.id,
      customValues: {}
    };

    if (selectedFieldKey === 'address') {
      nextPreview.addressLine1 = previewText;
    } else if (selectedFieldKey in nextPreview) {
      (nextPreview as any)[selectedFieldKey] = previewText;
    } else {
      nextPreview.customValues[selectedFieldKey] = previewText;
    }

    return nextPreview;
  }, [layout.brand, layout.id, previewCard, selectedField, selectedFieldKey]);

  const stylePreviewData = previewCard;

  const placementPreviewSide = useMemo(() => {
    if (!selectedFieldKey || !selectedField || fieldEditorSection !== 'placement') return sideLayout;

    return {
      ...sideLayout,
      fields: {
        [selectedFieldKey]: {
          ...selectedField,
          value: selectedField.label || selectedFieldKey
        }
      },
      fieldOrder: [selectedFieldKey]
    };
  }, [fieldEditorSection, selectedField, selectedFieldKey, sideLayout]);

  const effectiveCanvasScale = Math.min(canvasScale, fitCanvasScale);
  const effectiveFieldEditorPreviewScale = Number((fitFieldEditorPreviewScale * fieldEditorZoom).toFixed(3));

  const handleLayoutTitleChange = (value: string) => {
    commitLayout((draft) => {
      draft.name = value;
    });
  };

  const handleEnsureBackSide = () => {
    if (layout.back) return;
  };

  const openFieldEditor = (
    key: string,
    options?: { preferredSide?: 'front' | 'back'; section?: 'placement' | 'style' }
  ) => {
    if (options?.preferredSide) {
      setActiveSide(options.preferredSide);
    }
    setSingleSelection(key);
    if (options?.section) {
      setFieldEditorSection(options.section);
    }
    setShowFieldEditorModal(true);
  };

  const closeFieldEditor = () => {
    setShowFieldEditorModal(false);
  };

  useEffect(() => {
    if (!showFieldEditorModal) return;
    setFieldEditorZoom(DEFAULT_FIELD_EDITOR_ZOOM);
  }, [showFieldEditorModal, selectedFieldKey]);

  useEffect(() => {
    setShowPlacementDetails(false);
    setShowStyleAdvanced(false);
  }, [selectedFieldKey, fieldEditorSection]);

  useEffect(() => {
    if (!selectedFieldKey) {
      setShowFieldEditorModal(false);
    }
  }, [selectedFieldKey]);

  useEffect(() => {
    if (!activeSelectedFieldKeys.length) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTypingTarget = tagName === 'input' || tagName === 'textarea' || tagName === 'select' || Boolean(target?.isContentEditable);
      if (isTypingTarget) return;

      const multiplier = event.shiftKey ? 5 : 1;
      const delta = positionStep * multiplier;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handleNudgeField(selectedFieldKey || activeSelectedFieldKeys[0], 'left', -delta);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        handleNudgeField(selectedFieldKey || activeSelectedFieldKeys[0], 'left', delta);
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        handleNudgeField(selectedFieldKey || activeSelectedFieldKeys[0], 'top', -delta);
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        handleNudgeField(selectedFieldKey || activeSelectedFieldKeys[0], 'top', delta);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSelectedFieldKeys, positionStep, selectedFieldKey]);

  const editorTabs: Array<{ key: 'placement' | 'style'; label: string }> = [
    { key: 'placement', label: 'Position' },
    { key: 'style', label: 'Style' }
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-slate-200 bg-white p-4 md:p-5 space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <label className="block flex-1 min-w-[220px]">
            <span className="block text-[11px] font-black uppercase tracking-[0.3em] text-slate-400 mb-2">Layout Title</span>
            <input
              value={layout.name}
              onChange={(e) => handleLayoutTitleChange(e.target.value)}
              placeholder="Enter the title customers should see"
              className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-800"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveSide('front')}
              className={`px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.3em] border ${activeSide === 'front' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
            >
              <Eye size={14} className="mr-2 inline" /> Front
            </button>
            <button
              type="button"
              onClick={() => layout.back && setActiveSide('back')}
              className={`px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.3em] border flex items-center gap-2 ${activeSide === 'back' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
              disabled={!layout.back}
            >
              <EyeOff size={14} /> Back
            </button>
            {!layout.back && (
              <button
                type="button"
                onClick={handleEnsureBackSide}
                className="px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.3em] border border-dashed border-slate-300 text-slate-500"
              >
                + Add Back Side
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500">
          <p>Cmd/Ctrl-click or Shift-click to build a selection. Use arrow keys to nudge the active field.</p>
          <div className="flex flex-wrap gap-2">
            {onOpenAssets && (
              <button
                type="button"
                onClick={onOpenAssets}
                className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-[11px] font-black uppercase tracking-[0.2em] text-slate-600"
              >
                Fonts & Colors
              </button>
            )}
            {selectedField && selectedFieldKey ? (
              <>
                {editorTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => openFieldEditor(selectedFieldKey, { section: tab.key })}
                    className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-[11px] font-black uppercase tracking-[0.2em] text-slate-600"
                  >
                    {tab.label}
                  </button>
                ))}
              </>
            ) : (
              <span className="self-center text-[11px] font-semibold text-slate-400">Select a field to open it.</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
        <div className="space-y-4 min-w-0">
          <div className="rounded-[24px] border border-slate-200 bg-white p-4">
            <div ref={canvasViewportRef} className="mx-auto w-full overflow-auto">
              <div
                ref={canvasRef}
                className="relative rounded-[24px] bg-slate-100 border border-slate-200 p-4 overflow-hidden mx-auto"
                style={{ width: CARD_WIDTH * effectiveCanvasScale + CARD_FRAME_PADDING * 2, height: CARD_HEIGHT * effectiveCanvasScale + CARD_FRAME_PADDING * 2 }}
              >
                <BusinessCardPreview
                  data={previewCard}
                  side={sideLayout}
                  scale={effectiveCanvasScale}
                  overlayImage={showPreviewOverlay ? layout.previewImage : undefined}
                  overlayOpacity={previewOverlayOpacity}
                  settings={settings}
                  fontAssets={layout.fontAssets}
                  selectedFieldKey={selectedFieldKey}
                  onFieldClick={(key) => handleFieldSelection(key || null)}
                  onFieldBoundsChange={setFieldBounds}
                />
                <div
                  className="absolute"
                  style={{
                    top: CARD_FRAME_PADDING,
                    left: CARD_FRAME_PADDING,
                    width: CARD_WIDTH * effectiveCanvasScale,
                    height: CARD_HEIGHT * effectiveCanvasScale,
                    pointerEvents: 'none'
                  }}
                >
                  {fieldOrder.map((key) => {
                    const field = sideLayout.fields[key];
                    if (!field) return null;
                    const bounds = fieldBounds[key];
                    const { width, height } = getFieldMetrics(key, field);
                    const top = bounds?.top ?? field.top ?? 0;
                    const left = bounds?.left ?? field.left ?? 0;
                    return (
                      <button
                        key={key}
                        type="button"
                        onPointerDown={(event) => handleFieldDragStart(key, event, effectiveCanvasScale)}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleFieldSelection(key, { additive: event.metaKey || event.ctrlKey || event.shiftKey });
                        }}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          openFieldEditor(key, { section: 'placement' });
                        }}
                        className="absolute rounded-lg border border-transparent bg-transparent text-left"
                        style={{
                          top: top * effectiveCanvasScale,
                          left: left * effectiveCanvasScale,
                          width: width * effectiveCanvasScale,
                          height: height * effectiveCanvasScale,
                          cursor: 'grab',
                          pointerEvents: 'auto'
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.25em] text-slate-500">Canvas Controls</p>
                <p className="text-xs text-slate-500 mt-1">Upload the printable template for this side, then place fields directly over it.</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700">Safe margin {CARD_SAFE_MARGIN}px</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-black uppercase tracking-[0.25em] text-slate-500">
              <span>Zoom {Math.round(effectiveCanvasScale * 100)}%</span>
              <input type="range" min={0.3} max={0.9} step={0.05} value={canvasScale} onChange={(e) => setCanvasScale(Number(e.target.value))} className="w-full md:w-48" />
              <div className="flex gap-1">
                {POSITION_STEPS.map((step) => (
                  <button
                    key={step.points}
                    type="button"
                    onClick={() => setPositionStep(step.pixels)}
                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${positionStep === step.pixels ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
                  >
                    {step.points}pt
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSnapToGrid((prev) => !prev)}
                className={`ml-auto px-3 py-1.5 rounded-lg border text-xs font-semibold ${snapToGrid ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600'}`}
              >
                {snapToGrid ? 'Snap On' : 'Snap Off'}
              </button>
              <button
                type="button"
                onClick={() => setShowPreviewOverlay((prev) => !prev)}
                disabled={!layout.previewImage}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${showPreviewOverlay ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'} ${!layout.previewImage ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                {showPreviewOverlay ? 'Preview On' : 'Preview Off'}
              </button>
            </div>
            {layout.previewImage && (
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                <span className="font-black uppercase tracking-[0.25em] text-slate-500">Overlay Opacity</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={previewOverlayOpacity}
                  onChange={(e) => setPreviewOverlayOpacity(Number(e.target.value))}
                  className="w-full md:w-48"
                />
                <span className="font-semibold text-slate-700">{Math.round(previewOverlayOpacity * 100)}%</span>
              </div>
            )}
            {!layout.previewImage && (
              <p className="text-[11px] text-slate-500">Upload a customer preview image to compare the final approved look over the live layout while placing fields.</p>
            )}
            <div className="grid grid-cols-1 gap-4 text-[11px]">
              <label className="flex flex-col gap-2 text-xs font-black uppercase tracking-[0.3em] text-slate-500">
                <span className="flex items-center gap-2"><ImageIcon size={14} /> Template Image</span>
                <input ref={templateImageInputRef} type="file" accept="image/*" onChange={(e) => handleBackgroundUpload(e.target.files?.[0])} className="block w-full text-[11px]" />
                <span className="text-[11px] normal-case tracking-normal text-slate-500">This is the front or back artwork that prints behind the personalized text and also acts as your placement guide.</span>
              </label>
              {sideLayout.backgroundImage && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                  <span className="min-w-0 truncate font-semibold text-slate-800">Using: {currentTemplateImageName}</span>
                  <button type="button" onClick={handleRemoveBackgroundImage} className="shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-red-600">
                    Remove
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4 xl:sticky xl:top-4">
          <div className="bg-white border border-slate-100 rounded-[24px] p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-slate-900">Layout Fields</p>
                <p className="text-xs text-slate-500 mt-1">Click a field to open it. Use Cmd/Ctrl-click or Shift-click only when you want to select more than one.</p>
              </div>
              <span className="text-xs font-semibold text-slate-500">{layoutFieldEntries.length} fields</span>
            </div>
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-400">
              {selectedField && selectedFieldKey ? `${activeSelectedFieldKeys.length} selected. Click a row to edit it, or use modifier-click to keep building a multi-selection.` : 'Click any field row to edit it. New fields open automatically after you add them.'}
            </div>
            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
              {layoutFieldEntries.map((entry) => {
                const entryIsSelected = selectedFieldKeys.includes(entry.key);
                const primarySide = entry.sides.includes(activeSide) ? activeSide : entry.sides[0];
                return (
                  <div key={entry.key} className={`rounded-2xl border px-3.5 py-3 transition ${entryIsSelected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'}`}>
                    <div className="flex items-start gap-2.5">
                      <button
                        type="button"
                        onClick={(event) => {
                          const additive = event.metaKey || event.ctrlKey || event.shiftKey;
                          if (additive) {
                            handleFieldSelection(entry.key, { preferredSide: primarySide, additive: true });
                            return;
                          }
                          openFieldEditor(entry.key, { preferredSide: primarySide, section: 'style' });
                        }}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">{entry.label}</p>
                            <p className="mt-1 text-[11px] text-slate-500 truncate">{entry.key}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${entryIsSelected ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}>
                            {entryIsSelected ? 'Selected' : 'Open'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {entry.sides.map((sideName) => (
                            <span key={`${entry.key}-${sideName}`} className={`px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.18em] ${sideName === activeSide ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}>
                              {sideName}
                            </span>
                          ))}
                        </div>
                      </button>
                      <div className="shrink-0 flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            handleFieldSelection(entry.key, { preferredSide: primarySide });
                            handleDuplicateField(entry.key);
                          }}
                          className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-[11px] font-black uppercase tracking-[0.2em] text-slate-700"
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-2.5">
              <input
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                placeholder="Type a new field name"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm"
              />
              <button type="button" onClick={handleAddField} className="px-3.5 py-2.5 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-[0.3em] flex items-center gap-2">
                <Plus size={14} /> Add Field
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-100 rounded-[24px] p-6 space-y-5">
        <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
          <Tag size={14} /> Shopify Trigger Tags
        </div>
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Assigned Product</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{layout.shopifyProductHandle || 'No Shopify product linked yet'}</p>
            </div>
            {layout.shopifyProductHandle && (
              <button type="button" onClick={handleClearShopifyProduct} className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-slate-600">
                Clear Product
              </button>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <input
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Search Shopify products by title, handle, or tag"
              className="flex-1 px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-sm"
            />
          </div>
          {productPickerStatus === 'loading' && (
            <p className="text-xs text-slate-500">Loading Shopify products…</p>
          )}
          {productPickerStatus === 'unavailable' && (
            <p className="text-xs text-amber-700">Shopify product search is unavailable until the server is connected to your Shopify store.</p>
          )}
          {productPickerStatus === 'error' && (
            <p className="text-xs text-red-600">Unable to load Shopify products right now.</p>
          )}
          {productPickerStatus === 'ready' && !shopifyProducts.length && (
            <p className="text-xs text-slate-500">No Shopify products matched that search.</p>
          )}
          {!!shopifyProducts.length && (
            <div className="space-y-3">
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {shopifyProducts.map((product) => {
                  const isSelected = product.handle === layout.shopifyProductHandle;
                  return (
                    <button
                      key={product.handle}
                      type="button"
                      onClick={() => handleApplyShopifyProduct(product)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-slate-900">{product.title}</p>
                          <p className="mt-1 truncate text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{product.handle}</p>
                        </div>
                        {isSelected && <span className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-600">Selected</span>}
                      </div>
                      {!!product.tags.length && (
                        <p className="mt-2 line-clamp-2 text-xs text-slate-500">Tags: {product.tags.join(', ')}</p>
                      )}
                    </button>
                  );
                })}
              </div>
              {hasMoreShopifyProducts && (
                <button
                  type="button"
                  onClick={handleLoadMoreProducts}
                  disabled={productPickerStatus === 'loading'}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.24em] text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {productPickerStatus === 'loading' ? 'Loading More…' : 'Load More Products'}
                </button>
              )}
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-slate-500">Selecting a product stores its handle on the layout and syncs this layout's Shopify trigger tags from that product so the storefront button can target the right card.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {(layout.shopifyTags || []).map((tag) => (
            <span key={tag} className="px-3 py-1.5 rounded-full bg-slate-900 text-white text-[11px] font-black uppercase tracking-[0.3em] flex items-center gap-2">
              {tag}
              <button type="button" onClick={() => handleRemoveTag(tag)} className="text-white/70">×</button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2.5">
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddTag();
              }
            }}
            placeholder="property-brand-layout, luxury-suite"
            className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm"
          />
          <button type="button" onClick={handleAddTag} className="px-3.5 py-2.5 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-[0.3em]">Add Tag</button>
        </div>
        <div className="grid grid-cols-1 gap-4">
          <label className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Template Notes
            <textarea value={layout.previewUrl || ''} onChange={(e) => commitLayout((draft) => { draft.previewUrl = e.target.value; })} placeholder="Reference URL or production notes" className="mt-2 w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm" rows={4} />
          </label>
        </div>
        <div>
          <label className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Customer Preview Image
            <input ref={previewImageInputRef} type="file" accept="image/*" onChange={(e) => handlePreviewUpload(e.target.files?.[0])} className="mt-2 block w-full text-[11px]" />
            <span className="mt-2 block text-[11px] normal-case tracking-normal text-slate-500">Shown to customers in the layout gallery. If you leave this empty, the app can still render a live preview from the template and field positions.</span>
          </label>
          {layout.previewImage && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
              <span className="min-w-0 truncate font-semibold text-slate-800">Using: {currentPreviewImageName}</span>
              <button type="button" onClick={handleRemovePreviewImage} className="shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-red-600">
                Remove
              </button>
            </div>
          )}
        </div>
      </div>

      {showFieldEditorModal && selectedField && selectedFieldKey && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6">
          <button type="button" onClick={closeFieldEditor} className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" aria-label="Close field editor" />
          <div className="relative z-10 w-full max-w-[min(96vw,1400px)] max-h-[92vh] overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_80px_-20px_rgba(15,23,42,0.4)]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 md:px-6">
              <div className="space-y-3">
                <div>
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Field Editor</p>
                <h3 className="mt-2 text-2xl font-black text-slate-900">{selectedField.label || selectedFieldKey}</h3>
                <p className="mt-1 text-sm text-slate-500">Edit placement, field content, and typography without squeezing into the sidebar.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {editorTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setFieldEditorSection(tab.key)}
                      className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-[0.24em] border ${fieldEditorSection === tab.key ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-500'}`}
                    >
                      {tab.label}
                    </button>
                  ))}
                  <span className="text-[11px] font-semibold text-slate-400">Preview stays visible while you edit.</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => handleReorderField(selectedFieldKey, 'up')} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500"><ChevronUp size={18} /></button>
                <button type="button" onClick={() => handleReorderField(selectedFieldKey, 'down')} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500"><ChevronDown size={18} /></button>
                <button type="button" onClick={() => handleDuplicateField(selectedFieldKey)} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500"><Copy size={18} /></button>
                <button type="button" onClick={() => handleDeleteField(selectedFieldKey)} className="rounded-xl border border-red-100 bg-red-50 p-2 text-red-500"><Trash2 size={18} /></button>
                <button type="button" onClick={closeFieldEditor} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="max-h-[calc(92vh-128px)] overflow-y-auto px-5 py-4 md:px-6 md:py-5 xl:overflow-hidden">
              <div className="grid gap-5 xl:grid-cols-[minmax(340px,480px)_minmax(0,1fr)] xl:items-start">
                <div className="space-y-3 xl:sticky xl:top-4">
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">
                      <span>Zoom {Math.round(effectiveFieldEditorPreviewScale * 100)}%</span>
                      <input
                        type="range"
                        min={1}
                        max={MAX_FIELD_EDITOR_ZOOM}
                        step={0.1}
                        value={fieldEditorZoom}
                        onChange={(e) => setFieldEditorZoom(Number(e.target.value))}
                        className="w-full md:w-48"
                      />
                      <button
                        type="button"
                        onClick={() => setFieldEditorZoom(DEFAULT_FIELD_EDITOR_ZOOM)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${fieldEditorZoom === DEFAULT_FIELD_EDITOR_ZOOM ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
                      >
                        Fit
                      </button>
                      <span className="text-[11px] font-semibold normal-case tracking-normal text-slate-400">Drag directly on the highlighted field to place it.</span>
                    </div>
                    <div ref={fieldEditorPreviewRef} className="rounded-[20px] border border-slate-200 bg-white p-3 overflow-auto min-h-[clamp(280px,42vh,520px)]">
                        <div
                          className="relative mx-auto"
                          style={{ width: CARD_WIDTH * effectiveFieldEditorPreviewScale + CARD_FRAME_PADDING * 2, height: CARD_HEIGHT * effectiveFieldEditorPreviewScale + CARD_FRAME_PADDING * 2 }}
                        >
                          <BusinessCardPreview
                            data={fieldEditorSection === 'placement' ? placementPreviewData : stylePreviewData}
                            side={fieldEditorSection === 'placement' ? placementPreviewSide : sideLayout}
                            scale={effectiveFieldEditorPreviewScale}
                            overlayImage={showPreviewOverlay ? layout.previewImage : undefined}
                            overlayOpacity={previewOverlayOpacity}
                            settings={settings}
                            fontAssets={layout.fontAssets}
                            selectedFieldKey={selectedFieldKey}
                            onFieldBoundsChange={setFieldBounds}
                          />
                          {fieldEditorSection === 'placement' && selectedFieldKey && selectedField && (() => {
                            const bounds = fieldBounds[selectedFieldKey];
                            const { width, height } = getFieldMetrics(selectedFieldKey, selectedField);
                            const top = bounds?.top ?? selectedField.top ?? 0;
                            const left = bounds?.left ?? selectedField.left ?? 0;
                            return (
                              <div
                                className="absolute"
                                style={{
                                  top: CARD_FRAME_PADDING,
                                  left: CARD_FRAME_PADDING,
                                  width: CARD_WIDTH * effectiveFieldEditorPreviewScale,
                                  height: CARD_HEIGHT * effectiveFieldEditorPreviewScale,
                                  pointerEvents: 'none'
                                }}
                              >
                                <button
                                  type="button"
                                  onPointerDown={(event) => handleFieldDragStart(selectedFieldKey, event, effectiveFieldEditorPreviewScale)}
                                  aria-label={`Move ${selectedField.label || selectedFieldKey}`}
                                  className="absolute rounded-lg border border-transparent bg-transparent text-left"
                                  style={{
                                    top: top * effectiveFieldEditorPreviewScale,
                                    left: left * effectiveFieldEditorPreviewScale,
                                    width: width * effectiveFieldEditorPreviewScale,
                                    height: height * effectiveFieldEditorPreviewScale,
                                    cursor: 'grab',
                                    pointerEvents: 'auto'
                                  }}
                                />
                              </div>
                            );
                          })()}
                        </div>
                    </div>
                    <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600">
                      Editing <span className="font-semibold text-slate-900">{selectedField.label || selectedFieldKey}</span> on the <span className="font-semibold text-slate-900 capitalize">{activeSide}</span> side.
                    </div>
                  </div>
                </div>

                <div className="min-w-0 xl:max-h-[calc(92vh-200px)] xl:overflow-y-auto xl:pr-2">
              {fieldEditorSection === 'placement' && (
                <div className="space-y-5">
                  <div>
                    <p className="text-sm font-black text-slate-900">Position</p>
                    <p className="mt-1 text-xs text-slate-500">Move the field where it belongs, then use the quick buttons to tidy it up.</p>
                  </div>
                  <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4 space-y-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">1. Place The Box</p>
                      <p className="mt-1 text-xs text-slate-500">Drag the highlighted field over the template, then use these values if you want exact placement.</p>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <label className="text-xs font-semibold text-slate-500">Left Position
                        <input type="number" min={0} value={selectedField.left ?? 0} onChange={(e) => handleFieldPositionChange(selectedFieldKey, 'left', Number(e.target.value))} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800" />
                      </label>
                      <label className="text-xs font-semibold text-slate-500">Top Position
                        <input type="number" min={0} value={selectedField.top ?? 0} onChange={(e) => handleFieldPositionChange(selectedFieldKey, 'top', Number(e.target.value))} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800" />
                      </label>
                      <label className="text-xs font-semibold text-slate-500">Box Width
                        <input type="number" min={scaleLegacyValue(50)} value={selectedField.width ?? DEFAULT_FIELD_WIDTH} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'width', Number(e.target.value))} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800" />
                      </label>
                      <label className="text-xs font-semibold text-slate-500">Box Height
                        <input type="number" min={scaleLegacyValue(16)} value={selectedField.height ?? ''} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'height', Number(e.target.value) || undefined)} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800" />
                        <span className="mt-1 block text-[11px] text-slate-400">Leave blank to let the text decide its own height.</span>
                      </label>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Match The Typography</p>
                        <p className="mt-1 text-xs text-slate-500">Tweak the core font settings here while you line the field up to the artwork.</p>
                      </div>
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                        <label className="text-xs font-semibold text-slate-500 lg:col-span-3">Font Family
                          <select value={selectedField.fontFamily} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'fontFamily', e.target.value)} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800">
                            {fontChoices.map((option) => (
                              <option value={option.value} key={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-semibold text-slate-500">Weight
                          <select value={selectedField.fontWeight || '400'} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'fontWeight', e.target.value)} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800">
                            {weightOptions.map((option) => (
                              <option value={option.value} key={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-semibold text-slate-500">Canvas px
                          <input type="number" min={6} value={selectedField.fontSize} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'fontSize', Number(e.target.value))} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800" />
                        </label>
                        <label className="text-xs font-semibold text-slate-500">Print pt
                          <input type="number" min={1} step={0.1} value={selectedFieldPointSize ?? ''} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'fontSize', pointsToPixels(Number(e.target.value) || 0))} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800" />
                        </label>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">2. Snap It Into Place</p>
                      <p className="text-xs text-slate-500">Use these if the field should sit against an edge or the middle.</p>
                      <div className="grid grid-cols-3 gap-2">
                        <button type="button" onClick={() => handleAlignField(selectedFieldKey, 'left')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Left</button>
                        <button type="button" onClick={() => handleAlignField(selectedFieldKey, 'center')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Center</button>
                        <button type="button" onClick={() => handleAlignField(selectedFieldKey, 'right')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Right</button>
                        <button type="button" onClick={() => handleAlignField(selectedFieldKey, 'top')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Top</button>
                        <button type="button" onClick={() => handleAlignField(selectedFieldKey, 'middle')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Middle</button>
                        <button type="button" onClick={() => handleAlignField(selectedFieldKey, 'bottom')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Bottom</button>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">Need More Placement Options?</p>
                        <p className="mt-1 text-xs text-slate-500">Open this only if you need tiny moves, safe margins, or a quick reset.</p>
                      </div>
                      <button type="button" onClick={() => setShowPlacementDetails((prev) => !prev)} className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">
                        {showPlacementDetails ? 'Hide Options' : 'Show Options'}
                      </button>
                    </div>
                    {showPlacementDetails && (
                      <div className="mt-4 space-y-3">
                        <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold text-slate-500">How far should each nudge move?</p>
                            <span className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">{pixelsToPoints(positionStep)}pt</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {POSITION_STEPS.map((step) => (
                              <button
                                key={step.points}
                                type="button"
                                onClick={() => setPositionStep(step.pixels)}
                                className={`px-3 py-2 rounded-xl border text-sm font-semibold ${positionStep === step.pixels ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
                              >
                                {step.points}pt
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <button type="button" onClick={() => handleAlignField(selectedFieldKey, 'safe-left')} className="px-3 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-700">Safe Left</button>
                          <button type="button" onClick={() => handleAlignField(selectedFieldKey, 'safe-right')} className="px-3 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-700">Safe Right</button>
                          <button type="button" onClick={() => handleAlignField(selectedFieldKey, 'safe-top')} className="px-3 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-700">Safe Top</button>
                          <button type="button" onClick={() => handleAlignField(selectedFieldKey, 'safe-bottom')} className="px-3 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-700">Safe Bottom</button>
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                          <button type="button" onClick={() => handleNudgeField(selectedFieldKey, 'left', -positionStep)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Move Left</button>
                          <button type="button" onClick={() => handleNudgeField(selectedFieldKey, 'left', positionStep)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Move Right</button>
                          <button type="button" onClick={() => handleNudgeField(selectedFieldKey, 'top', -positionStep)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Move Up</button>
                          <button type="button" onClick={() => handleNudgeField(selectedFieldKey, 'top', positionStep)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Move Down</button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => handleAutoFitWidth(selectedFieldKey)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Fit To Text</button>
                          <button type="button" onClick={() => handleResetFieldBox(selectedFieldKey)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Reset Box</button>
                        </div>
                      </div>
                    )}
                  </div>
                  {activeSelectedFieldKeys.length > 1 && (
                    <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">Align Selection Together</p>
                        <p className="mt-1 text-xs text-slate-500">Use the selected fields' shared bounds to line them up without relying on one active anchor.</p>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <button type="button" onClick={() => handleAlignSelection('left')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Left</button>
                        <button type="button" onClick={() => handleAlignSelection('center')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Center</button>
                        <button type="button" onClick={() => handleAlignSelection('right')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Right</button>
                        <button type="button" onClick={() => handleAlignSelection('top')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Top</button>
                        <button type="button" onClick={() => handleAlignSelection('middle')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Middle</button>
                        <button type="button" onClick={() => handleAlignSelection('bottom')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Bottom</button>
                      </div>
                    </div>
                  )}
                  {activeSelectedFieldKeys.length > 1 && selectedFieldKey && (
                    <div className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">Align To Active Field</p>
                        <p className="mt-1 text-xs text-slate-500">The current field stays fixed. The rest of the selection snaps to it.</p>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <button type="button" onClick={() => handleAlignFieldsToPrimary('left')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Left</button>
                        <button type="button" onClick={() => handleAlignFieldsToPrimary('center')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Center</button>
                        <button type="button" onClick={() => handleAlignFieldsToPrimary('right')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Right</button>
                        <button type="button" onClick={() => handleAlignFieldsToPrimary('top')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Top</button>
                        <button type="button" onClick={() => handleAlignFieldsToPrimary('middle')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Middle</button>
                        <button type="button" onClick={() => handleAlignFieldsToPrimary('bottom')} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">Bottom</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {fieldEditorSection === 'style' && (
                <div className="space-y-5">
                  <div>
                    <p className="text-sm font-black text-slate-900">Style</p>
                    <p className="mt-1 text-xs text-slate-500">Most fields only need a name, starting text, font, size, and color.</p>
                  </div>
                  <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4 space-y-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">1. What Should This Field Say?</p>
                      <p className="mt-1 text-xs text-slate-500">Pick the label your customer sees and the default text shown in the preview.</p>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <label className="text-xs font-semibold text-slate-500">Field Name
                        <input value={selectedField.label || ''} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'label', e.target.value)} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800" />
                      </label>
                      <label className="text-xs font-semibold text-slate-500">Default Text
                        <input value={selectedField.value || ''} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'value', e.target.value)} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800" />
                      </label>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <label className="text-xs font-semibold text-slate-500 lg:col-span-2">Pick A Font
                        <select value={selectedField.fontFamily} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'fontFamily', e.target.value)} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800">
                          {fontChoices.map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <span className="mt-1 block text-[11px] text-slate-400">Choose from the shared layout fonts, then fine tune weight and size.</span>
                      </label>
                      <label className="text-xs font-semibold text-slate-500">Weight
                        <select value={selectedField.fontWeight || '400'} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'fontWeight', e.target.value)} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800">
                          {weightOptions.map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-slate-500">Font Size
                        <div className="mt-1.5 grid grid-cols-1 gap-2 md:grid-cols-2">
                          <label className="text-[11px] font-semibold text-slate-400">Canvas px
                            <input type="number" min={6} value={selectedField.fontSize} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'fontSize', Number(e.target.value))} className="mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800" />
                          </label>
                          <label className="text-[11px] font-semibold text-slate-400">Print pt
                            <input type="number" min={1} step={0.1} value={selectedFieldPointSize ?? ''} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'fontSize', pointsToPixels(Number(e.target.value) || 0))} className="mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800" />
                          </label>
                        </div>
                        <span className="mt-1 block text-[11px] text-slate-400">The card canvas is 300 dpi, so 9 pt prints at about 37.5 px.</span>
                      </label>
                    </div>
                  </div>
                  <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4 space-y-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">2. How Should It Look?</p>
                      <p className="mt-1 text-xs text-slate-500">Set alignment and colors. Stop here unless you truly need more.</p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-slate-500">Alignment</p>
                      <div className="grid grid-cols-3 gap-2">
                        {HORIZONTAL_ALIGNMENT_OPTIONS.map((align) => (
                          <button key={align.value} type="button" onClick={() => handleFieldValueChange(selectedFieldKey, 'textAlign', align.value)} className={`px-3 py-2.5 rounded-xl border text-sm font-semibold ${selectedField.textAlign === align.value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
                            {align.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <label className="text-xs font-semibold text-slate-500 lg:col-span-2">Saved Text Swatch
                        <select
                          value={selectedFieldColorPresetId}
                          onChange={(e) => {
                            const preset = colorPresets.find((entry) => entry.id === e.target.value);
                            if (preset) {
                              applyCmykToField(selectedFieldKey, preset.cmyk);
                              return;
                            }
                            handleFieldValueChange(selectedFieldKey, 'cmyk', undefined);
                          }}
                          className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800"
                        >
                          <option value="">Choose a saved swatch</option>
                          {colorPresets.map((preset) => (
                            <option key={preset.id} value={preset.id}>{formatColorPresetLabel(preset)}</option>
                          ))}
                        </select>
                        <span className="mt-1 block text-[11px] text-slate-400">These come from the shared colors saved near the top of the editor.</span>
                      </label>
                      <label className="text-xs font-semibold text-slate-500">Text Color
                        <div className="mt-1.5 flex items-center gap-2">
                          <input type="color" value={selectedField.color || '#000000'} onChange={(e) => {
                            handleFieldValueChange(selectedFieldKey, 'color', e.target.value);
                            const nextCmyk = hexToCmyk(e.target.value);
                            if (nextCmyk) handleFieldValueChange(selectedFieldKey, 'cmyk', normalizeCmyk(nextCmyk));
                          }} className="h-11 w-16 rounded-xl bg-white border border-slate-200" />
                          <input type="text" value={selectedField.color || '#000000'} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'color', e.target.value)} className="flex-1 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-800" />
                        </div>
                        <span className="mt-1 block text-[11px] text-slate-400">Print target: {formatCmykLabel(selectedFieldCmyk)}</span>
                      </label>
                      <label className="text-xs font-semibold text-slate-500">Background Fill
                        <input type="color" value={selectedField.backgroundColor || '#ffffff'} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'backgroundColor', e.target.value)} className="mt-1.5 w-full h-11 rounded-xl bg-white border border-slate-200" />
                      </label>
                    </div>
                  </div>
                  <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">Need More Style Options?</p>
                        <p className="mt-1 text-xs text-slate-500">Open this for masks, visibility, and deeper formatting.</p>
                      </div>
                      <button type="button" onClick={() => setShowStyleAdvanced((prev) => !prev)} className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700">
                        {showStyleAdvanced ? 'Hide Options' : 'Show Options'}
                      </button>
                    </div>
                    {showStyleAdvanced && (
                      <div className="mt-4 grid grid-cols-1 gap-3">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                          <div>
                            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Type</p>
                            <p className="mt-1 text-xs text-slate-500">Spacing, case, mask, and text effects.</p>
                          </div>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-slate-500">Text Case</p>
                              <div className="grid grid-cols-2 gap-2">
                                {TEXT_CASE_OPTIONS.map((mode) => (
                                  <button key={mode.value} type="button" onClick={() => handleFieldValueChange(selectedFieldKey, 'textTransform', mode.value)} className={`px-3 py-2.5 rounded-xl border text-sm font-semibold ${((selectedField.textTransform || 'none') === mode.value) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
                                    {mode.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                              <button type="button" onClick={() => handleFieldValueChange(selectedFieldKey, 'fontStyle', selectedField.fontStyle === 'italic' ? 'normal' : 'italic')} className={`px-4 py-2.5 rounded-xl border text-sm font-semibold ${selectedField.fontStyle === 'italic' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}>Italic</button>
                              <button type="button" onClick={() => handleFieldValueChange(selectedFieldKey, 'textDecoration', selectedField.textDecoration === 'underline' ? 'none' : 'underline')} className={`px-4 py-2.5 rounded-xl border text-sm font-semibold ${selectedField.textDecoration === 'underline' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}>Underline</button>
                              <label className="text-xs font-semibold text-slate-500">Opacity
                                <input type="range" min={0} max={1} step={0.05} value={selectedField.opacity ?? 1} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'opacity', Number(e.target.value))} className="mt-1.5 w-full" />
                                <span className="text-[11px] text-slate-500">{Math.round((selectedField.opacity ?? 1) * 100)}%</span>
                              </label>
                            </div>
                            <label className="text-xs font-semibold text-slate-500">Line Height
                              <input type="number" step={0.05} value={selectedField.lineHeight ?? 1.2} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'lineHeight', Number(e.target.value))} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800" />
                            </label>
                            <label className="text-xs font-semibold text-slate-500">Letter Spacing
                              <input type="text" value={selectedField.letterSpacing || ''} placeholder="e.g. 0.05em" onChange={(e) => handleFieldValueChange(selectedFieldKey, 'letterSpacing', e.target.value)} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800" />
                            </label>
                            <label className="text-xs font-semibold text-slate-500">Max Width
                              <input type="number" min={50} value={selectedField.maxWidth ?? ''} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'maxWidth', Number(e.target.value) || undefined)} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800" />
                            </label>
                            <label className="text-xs font-semibold text-slate-500">Field Mask
                              <div className="mt-1.5 grid grid-cols-1 md:grid-cols-2 gap-2">
                                <select value={selectedMaskPresetId} onChange={(e) => handleMaskPresetChange(e.target.value)} className="px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm">
                                  {maskPresets.map((preset) => (
                                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                                  ))}
                                  <option value="custom">Custom pattern</option>
                                </select>
                                <input value={selectedField.pattern || ''} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'pattern', e.target.value)} placeholder="# for digits, letters stay literal" className="px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
                              </div>
                            </label>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                          <div>
                            <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Content</p>
                            <p className="mt-1 text-xs text-slate-500">Prefixes, suffixes, visibility, and stacking.</p>
                          </div>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <label className="text-xs font-semibold text-slate-500">Prefix
                              <input value={selectedField.prefix || ''} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'prefix', e.target.value)} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800" />
                            </label>
                            <label className="text-xs font-semibold text-slate-500">Suffix
                              <input value={selectedField.suffix || ''} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'suffix', e.target.value)} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800" />
                            </label>
                            <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                              <div>
                                <p className="text-sm font-black text-slate-900">Required</p>
                                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-400">Guests must fill it</p>
                              </div>
                              <button type="button" onClick={() => handleFieldValueChange(selectedFieldKey, 'required', !selectedField.required)} className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-[0.24em] border ${selectedField.required ? 'bg-emerald-500 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-500'}`}>
                                {selectedField.required ? 'On' : 'Off'}
                              </button>
                            </div>
                            <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                              <div>
                                <p className="text-sm font-black text-slate-900">Show In Form</p>
                                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-400">Visible during input</p>
                              </div>
                              <button type="button" onClick={() => handleFieldValueChange(selectedFieldKey, 'showInForm', selectedField.showInForm === false ? true : false)} className={`px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-[0.24em] border ${selectedField.showInForm === false ? 'bg-slate-200 border-slate-300 text-slate-600' : 'bg-white border-slate-200 text-slate-500'}`}>
                                {selectedField.showInForm === false ? 'Off' : 'On'}
                              </button>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Position Model</p>
                              <p className="mt-1 text-sm font-semibold text-slate-800">All fields use top-left X/Y coordinates.</p>
                              <p className="mt-1 text-[11px] text-slate-500">This matches Illustrator-style box positioning across every alignment.</p>
                            </div>
                            <label className="text-xs font-semibold text-slate-500">Z-Index
                              <input type="number" min={0} value={selectedField.zIndex ?? 1} onChange={(e) => handleFieldValueChange(selectedFieldKey, 'zIndex', Number(e.target.value))} className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm" />
                            </label>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LayoutEditor;
