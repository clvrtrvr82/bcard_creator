import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { CardData, Layout, AppSettings, BrandConfig, ColorPreset, SideLayout, FieldStyle } from './types';
import { BRAND_CONFIGS } from './constants';
import { CARD_CANVAS_VERSION, convertLegacyDisplayScale, normalizeFieldStyle } from './cardCanvas';
import { loadPersistedLayouts, persistLayouts } from './persistence';
import BusinessCardPreview from './components/BusinessCardPreview';
import AdminDashboard from './components/AdminDashboard';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { cmykToHex, cmykToRgb, hexToCmyk, hexToRgb, normalizeCmyk, normalizeHex, normalizeRgb, rgbToCmyk } from './utils/color';
import { pixelsToPoints } from './cardCanvas';
import { buildCardSvg } from './utils/vectorExport';
import { 
  ChevronRight, ArrowLeft, Search, Layers, Lock, LogOut, Settings, Download, CheckCircle
} from 'lucide-react';

const SETTINGS_KEY = 'theme-vault-settings';
const ADMIN_AUTH_KEY = 'theme-vault-admin-session';
const LAYOUT_STORAGE_KEY = 'theme-vault-layouts';
const SHOPIFY_CART_ENABLED = import.meta.env?.VITE_ENABLE_SHOPIFY_CART === 'true';
const SHOPIFY_TAG_LOOKUP_ENABLED = import.meta.env?.VITE_ENABLE_SHOPIFY_TAG_LOOKUP === 'true';
const isBrowser = typeof window !== 'undefined';
const safeLocalStorage = isBrowser ? window.localStorage : null;
const safeSessionStorage = isBrowser ? window.sessionStorage : null;

const DEFAULT_SETTINGS: AppSettings = {
  appName: 'THEMEVAULT',
  businessName: 'Vault Printing Co.',
  businessEmail: 'support@themevault.io',
  businessPhone: '1-800-VAULT',
  businessAddress: '123 Print St, Creative District, NY',
  businessWebsite: 'themevault.io',
  primaryColor: '#0f172a', 
  logoUrl: ''
};

const normalizeFields = (fields: Record<string, FieldStyle>, canvasVersion?: number): Record<string, FieldStyle> => {
  return Object.entries(fields).reduce<Record<string, FieldStyle>>((acc, [key, field]) => {
    acc[key] = {
      ...normalizeFieldStyle(field, canvasVersion),
      showInForm: field.showInForm === false ? false : true
    };
    return acc;
  }, {});
};

const normalizeSideLayout = (side: SideLayout): SideLayout => {
  return {
    ...side,
    fields: normalizeFields(side.fields),
    fieldOrder: Array.isArray(side.fieldOrder) && side.fieldOrder.length ? side.fieldOrder : Object.keys(side.fields)
  };
};

const normalizeColorPresets = (presets?: ColorPreset[] | string[]): ColorPreset[] | undefined => {
  if (!presets || !Array.isArray(presets) || !presets.length) return undefined;
  return presets
    .map((preset, index) => {
      if (typeof preset === 'string') {
        const cmyk = hexToCmyk(preset);
        const hex = normalizeHex(preset);
        return cmyk ? { id: `legacy-${index}`, cmyk, hex: hex || undefined, rgb: hex ? hexToRgb(hex) || undefined : undefined, name: undefined } : null;
      }
      if (preset && typeof preset === 'object') {
        const cast = preset as ColorPreset;
        const normalizedHex = normalizeHex(cast.hex) || normalizeHex(cmykToHex(cast.cmyk));
        const normalizedRgb = cast.rgb ? normalizeRgb(cast.rgb) : (normalizedHex ? hexToRgb(normalizedHex) : cmykToRgb(cast.cmyk));
        const normalizedCmyk = cast.cmyk
          ? normalizeCmyk(cast.cmyk)
          : normalizedHex
            ? normalizeCmyk(hexToCmyk(normalizedHex) || undefined)
            : normalizedRgb
              ? normalizeCmyk(rgbToCmyk(normalizedRgb) || undefined)
              : null;
        if (!normalizedCmyk) return null;
        return {
          id: cast.id || `preset-${index}`,
          name: cast.name,
          cmyk: normalizedCmyk,
          hex: normalizedHex || undefined,
          rgb: normalizedRgb || undefined,
          pantone: cast.pantone?.trim() || undefined,
          notes: cast.notes?.trim() || undefined
        };
      }
      return null;
    })
    .filter(Boolean) as ColorPreset[];
};

const normalizeLayout = (layout: Layout): Layout => {
  return {
    ...layout,
    canvasVersion: CARD_CANVAS_VERSION,
    shopifyProductHandle: layout.shopifyProductHandle || '',
    front: {
      ...layout.front,
      fields: normalizeFields(layout.front.fields, layout.canvasVersion),
      fieldOrder: Array.isArray(layout.front.fieldOrder) && layout.front.fieldOrder.length ? layout.front.fieldOrder : Object.keys(layout.front.fields)
    },
    back: layout.back ? {
      ...layout.back,
      fields: normalizeFields(layout.back.fields, layout.canvasVersion),
      fieldOrder: Array.isArray(layout.back.fieldOrder) && layout.back.fieldOrder.length ? layout.back.fieldOrder : Object.keys(layout.back.fields)
    } : undefined,
    colorPresets: normalizeColorPresets(layout.colorPresets)
  };
};

const normalizeBrandConfigs = (configs: Record<string, BrandConfig>): Record<string, BrandConfig> => {
  return Object.entries(configs).reduce<Record<string, BrandConfig>>((acc, [brand, config]) => {
    acc[brand] = {
      ...config,
      layouts: config.layouts.map(normalizeLayout)
    };
    return acc;
  }, {});
};

const formatCmykLabel = (field: FieldStyle) => {
  const cmyk = normalizeCmyk(field.cmyk || hexToCmyk(field.color) || { c: 0, m: 0, y: 0, k: 0 });
  return `C${cmyk.c} M${cmyk.m} Y${cmyk.y} K${cmyk.k}`;
};

const downloadTextFile = (fileName: string, content: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const cloneBrandConfigs = (configs: Record<string, BrandConfig>): Record<string, BrandConfig> => JSON.parse(JSON.stringify(configs));

const getBaseBrandConfigs = (): Record<string, BrandConfig> => normalizeBrandConfigs(cloneBrandConfigs(BRAND_CONFIGS as Record<string, BrandConfig>));

const getLegacyStoredLayouts = (): Record<string, BrandConfig> | null => {
  if (!safeLocalStorage) return null;
  try {
    const stored = safeLocalStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, BrandConfig>;
  } catch (error) {
    console.warn('Unable to load stored layouts from localStorage.', error);
    return null;
  }
};

const findLayoutById = (configs: Record<string, BrandConfig>, layoutId: string | null): Layout | null => {
  if (!layoutId) return null;
  for (const config of Object.values(configs)) {
    const match = config.layouts.find(layout => layout.id === layoutId);
    if (match) return match;
  }
  return null;
};

const getAppSettings = (): AppSettings => {
  if (!safeLocalStorage) return DEFAULT_SETTINGS;
  try {
    const stored = safeLocalStorage.getItem(SETTINGS_KEY);
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  } catch (error) {
    console.warn('Unable to load stored settings, using defaults.', error);
    return DEFAULT_SETTINGS;
  }
};

const AdminGuard = ({ children, isAdmin, onLogin, settings }: { children?: React.ReactNode, isAdmin: boolean, onLogin: (p: string) => boolean, settings: AppSettings }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  if (isAdmin) return <>{children}</>;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 animate-fadeIn">
      <div className="w-full max-w-md space-y-8 bg-white p-12 rounded-[48px] shadow-2xl border border-slate-100 text-center">
        <div className="w-20 h-20 bg-slate-900 rounded-3xl flex items-center justify-center text-white mx-auto mb-6 shadow-xl" style={{ backgroundColor: settings.primaryColor }}>
          <Lock size={40} />
        </div>
        <h2 className="text-4xl font-black text-slate-900 uppercase tracking-tighter">Vault Admin</h2>
        <form onSubmit={(e) => { e.preventDefault(); if (!onLogin(password)) setError(true); }} className="space-y-6">
          <input 
            type="password" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            className="w-full p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center font-bold text-2xl outline-none focus:ring-4 focus:ring-blue-500/10 transition-all"
            placeholder="ACCESS CODE"
            autoFocus
          />
          {error && <p className="text-xs text-red-500 font-black uppercase tracking-widest">Unauthorized Access</p>}
          <button type="submit" className="w-full py-6 rounded-2xl text-white font-black uppercase tracking-[0.2em] shadow-xl hover:opacity-90 active:scale-[0.98] transition-all text-lg" style={{ backgroundColor: settings.primaryColor }}>
            Unlock Dashboard
          </button>
        </form>
      </div>
    </div>
  );
};

const getShopifyQueryTags = (): string[] => {
  if (typeof window === 'undefined') return [];
  const params = new URLSearchParams(window.location.search);
  const tags = new Set<string>();
  [...params.getAll('tag'), ...params.getAll('tags')].forEach((value) => {
    value.split(',').forEach((tag) => {
      const normalized = tag.trim().toLowerCase();
      if (normalized) tags.add(normalized);
    });
  });
  return Array.from(tags);
};

const getProductHandleFromQuery = (): string | null => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('product')?.trim() || null;
};

const getLayoutIdFromQuery = (): string | null => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('layoutId')?.trim() || params.get('layout')?.trim() || null;
};

const getReturnUrlFromQuery = (): string | null => {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const candidate = params.get('returnTo')?.trim() || params.get('return_to')?.trim();
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate, window.location.origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch (error) {
    console.warn('Ignoring invalid Shopify return URL.', error);
    return null;
  }
};

const buildReturnUrl = (target: string, params: Record<string, string | null | undefined>) => {
  const url = new URL(target);
  Object.entries(params).forEach(([key, value]) => {
    if (!value) return;
    url.searchParams.set(key, value);
  });
  return url.toString();
};

const buildPreviewCardData = (layout: Layout): CardData => ({
  name: 'Jordan Lee',
  jobTitle: 'Brand Lead',
  email: 'preview@themevault.io',
  phone: '5551239876',
  mobile: '5554442222',
  addressLine1: '123 Preview Way',
  website: 'themevault.io',
  brand: layout.brand,
  layoutId: layout.id,
  customValues: {}
});

const SelectionScreen = ({ onNext, settings, brandConfigs, activeTags }: { onNext: (l: Layout) => void, settings: AppSettings, brandConfigs: Record<string, BrandConfig>, activeTags: string[] }) => {
  const [search, setSearch] = useState('');
  const allLayouts = useMemo(() => Object.values(brandConfigs).flatMap(bc => bc.layouts), [brandConfigs]);
  const tagFilteredLayouts = useMemo(() => {
    if (!activeTags.length) return allLayouts;
    return allLayouts.filter((layout) => layout.shopifyTags?.some((tag) => activeTags.includes(tag.toLowerCase())));
  }, [activeTags, allLayouts]);
  const layouts = useMemo(() => tagFilteredLayouts.filter(l => l.name.toLowerCase().includes(search.toLowerCase())), [search, tagFilteredLayouts]);

  return (
    <div className="max-w-6xl mx-auto p-8 animate-fadeIn pb-24">
      <div className="text-center space-y-6 mb-16">
        <h1 className="text-5xl font-black text-slate-900 uppercase tracking-tight">The Vault Collection</h1>
        <p className="text-slate-500 font-medium max-w-2xl mx-auto text-base leading-relaxed">
          {activeTags.length
            ? `Showing layouts matched to this product: ${activeTags.join(', ')}`
            : 'Select a template to begin customizing. Use filters to jump directly to the right property or tag.'}
        </p>
        <div className="max-w-md mx-auto relative">
          <input 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            placeholder="Search layouts" 
            className="w-full bg-white border border-slate-200 px-10 py-4 rounded-2xl shadow-sm focus:ring-4 focus:ring-blue-500/10 outline-none text-base" 
          />
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20}/>
        </div>
      </div>
      {!layouts.length && (
        <div className="rounded-[32px] border border-slate-200 bg-white px-8 py-10 text-center text-slate-500 shadow-sm">
          No layouts match the current product tags.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {layouts.map(l => (
          <button 
            key={l.id} 
            onClick={() => onNext(l)} 
            className="group bg-white rounded-[32px] border border-slate-100 overflow-hidden text-left hover:border-blue-500 transition-all hover:shadow-[0_25px_50px_-20px_rgba(15,23,42,0.3)]"
          >
            <div className="aspect-[3.5/2] bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center overflow-hidden border-b border-slate-100 p-4">
              <div className="rounded-[24px] border border-slate-200 bg-white shadow-[0_20px_40px_-24px_rgba(15,23,42,0.35)] overflow-hidden">
                {l.previewImage ? (
                  <img src={l.previewImage} alt={l.name} className="block w-full h-full object-cover" />
                ) : (
                  <BusinessCardPreview data={buildPreviewCardData(l)} scale={convertLegacyDisplayScale(0.65)} side={l.front} settings={settings} fontAssets={l.fontAssets} />
                )}
              </div>
            </div>
            <div className="p-6 flex justify-between items-center">
              <div>
                <p className="font-black text-slate-900 text-xl uppercase tracking-tight group-hover:text-blue-600 transition-colors">{l.name}</p>
              </div>
              <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all shadow-sm">
                <ChevronRight size={20} strokeWidth={3} />
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

interface ProductVariantOption {
  id: number;
  title: string;
  price: number;
  available: boolean;
}

interface ShopifyCapabilities {
  productProxyEnabled: boolean;
  tagLookupEnabled: boolean;
  cartEnabled: boolean;
  productProxyReason?: string | null;
  tagLookupReason?: string | null;
  cartReason?: string | null;
}

const normalizeVariantPrice = (value: unknown) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    if (trimmed.includes('.')) {
      const dollars = Number.parseFloat(trimmed);
      return Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
    }
    const cents = Number.parseInt(trimmed, 10);
    return Number.isFinite(cents) ? cents : 0;
  }

  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Number.isInteger(numeric) ? numeric : Math.round(numeric * 100);
};

const toBase64Url = (value: string) => {
  const utf8 = new TextEncoder().encode(value);
  let binary = '';
  utf8.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const ADDRESS_FIELD_KEYS = new Set(['addressLine1', 'addressLine2', 'address', 'address1', 'address2']);

const AddressAutocomplete: React.FC<{
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  hasError?: boolean;
  ariaRequired?: boolean;
  ariaInvalid?: boolean;
}> = ({ value, onChange, placeholder, hasError, ariaRequired, ariaInvalid }) => {
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [open, setOpen] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const fetchSuggestions = (query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 3) { setSuggestions([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en', 'User-Agent': 'ThemeVaultDesigner/1.0' } });
        const data: any[] = await res.json();
        const formatted = data.map((item) => {
          const a = item.address || {};
          const street = a.house_number && a.road ? `${a.house_number} ${a.road}` : (a.road || '');
          const city = a.city || a.town || a.village || a.municipality || a.county || '';
          const state = a.state || '';
          const postal = a.postcode || '';
          return [street, city, state, postal].filter(Boolean).join(', ');
        }).filter(Boolean);
        setSuggestions(formatted);
        setOpen(formatted.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 400);
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); fetchSuggestions(e.target.value); }}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        placeholder={placeholder}
        autoComplete="off"
        aria-required={ariaRequired || undefined}
        aria-invalid={ariaInvalid || undefined}
        className={`w-full px-4 py-3 rounded-2xl text-sm font-medium text-slate-900 focus:bg-white focus:ring-4 outline-none ${hasError ? 'bg-red-50 border border-red-300 focus:ring-red-200' : 'bg-slate-50 border border-slate-200 focus:ring-blue-100'}`}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden">
          {suggestions.map((suggestion, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { onChange(suggestion); setSuggestions([]); setOpen(false); }}
              className="w-full px-4 py-3 text-left text-sm text-slate-800 hover:bg-slate-50 border-b border-slate-100 last:border-0"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const buildShopifyCartPermalink = ({
  returnUrl,
  variantId,
  quantity,
  properties
}: {
  returnUrl: string;
  variantId: number;
  quantity: number;
  properties: Record<string, string>;
}) => {
  const parsed = new URL(returnUrl);
  const params = new URLSearchParams({ storefront: 'true' });
  const propertyEntries = Object.entries(properties)
    .filter(([, value]) => String(value || '').trim())
    .slice(0, 25);

  if (propertyEntries.length) {
    params.set('properties', toBase64Url(JSON.stringify(Object.fromEntries(propertyEntries))));
  }

  return `${parsed.origin}/cart/${variantId}:${Math.max(1, quantity)}?${params.toString()}`;
};

const PRODUCT_REQUEST_TIMEOUT_MS = 12000;

const fetchWithTimeout = async (input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = PRODUCT_REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const formatCurrency = (price: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price / 100);

const CustomizerScreen = ({ layout, onBack, onComplete, settings, productHandle, returnUrl, cartEnabled, cartReason, tagLookupEnabled, isAdmin }: { layout: Layout, onBack: () => void, onComplete: (data: CardData) => void, settings: AppSettings, productHandle: string | null, returnUrl: string | null, cartEnabled: boolean, cartReason?: string | null, tagLookupEnabled: boolean, isAdmin: boolean }) => {
  const [step, setStep] = useState<'form' | 'proof' | 'quantity'>('form');
  const [data, setData] = useState<CardData>({ brand: layout.brand, layoutId: layout.id, name: '', jobTitle: '', email: '', phone: '', mobile: '', addressLine1: '', website: '', customValues: {} });
  const totalSteps = cartEnabled ? 3 : 2;
  const getStepPosition = (target: 'form' | 'proof' | 'quantity') => {
    if (target === 'form') return 1;
    if (target === 'proof') return 2;
    return cartEnabled ? 3 : 2;
  };
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [proofStatus, setProofStatus] = useState<'idle' | 'generating'>('idle');
  const [checkoutStatus, setCheckoutStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [productOptions, setProductOptions] = useState<ProductVariantOption[]>([]);
  const [productStatus, setProductStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [selectedVariant, setSelectedVariant] = useState<ProductVariantOption | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const [previewSide, setPreviewSide] = useState<'front' | 'back'>('front');
  const [derivedProductHandle, setDerivedProductHandle] = useState<string | null>(null);
  const [productSource, setProductSource] = useState<'query' | 'layout' | 'tags' | null>(null);
  const proofRef = useRef<HTMLDivElement>(null);
  const baseProductHandle = useMemo(() => productHandle || layout.shopifyProductHandle || null, [productHandle, layout.shopifyProductHandle]);
  const tagLookupActive = tagLookupEnabled && Boolean(layout.shopifyTags?.length);
  const effectiveProductHandle = baseProductHandle || derivedProductHandle;
  const allFieldKeys = useMemo(() => Array.from(new Set([...(layout.front?.fieldOrder || []), ...(layout.back?.fieldOrder || [])])), [layout.id]);
  const getFieldDefinition = useCallback((key: string) => layout.front?.fields?.[key] || layout.back?.fields?.[key], [layout]);
  const formFieldKeys = useMemo(() => allFieldKeys.filter((key) => getFieldDefinition(key)?.showInForm !== false), [allFieldKeys, getFieldDefinition]);
  const lockedFieldKeys = useMemo(() => allFieldKeys.filter((key) => getFieldDefinition(key)?.showInForm === false), [allFieldKeys, getFieldDefinition]);
  const hasBackSide = Boolean(layout.back);
  const previewSideLayout = previewSide === 'front' ? layout.front : layout.back || layout.front;
  const canReturnToProduct = Boolean(returnUrl);
  const getFieldValue = useCallback((key: string, sourceData: CardData = data) => {
    if (Object.prototype.hasOwnProperty.call(sourceData, key)) {
      const raw = (sourceData as any)[key];
      if (raw === undefined || raw === null) return '';
      return typeof raw === 'string' ? raw : String(raw);
    }
    return sourceData.customValues?.[key] || '';
  }, [data]);

  const returnToProductPage = useCallback((params?: Record<string, string | null | undefined>) => {
    if (!returnUrl) return;
    window.location.href = buildReturnUrl(returnUrl, params || {});
  }, [returnUrl]);

  const buildLineItemProperties = useCallback((proofReference: string | null) => {
    const properties: Record<string, string> = {
      'Layout ID': layout.id,
      'Layout Name': layout.name,
      'Proof Reference': proofReference || 'manual_review'
    };

    if (effectiveProductHandle) {
      properties['Product Handle'] = effectiveProductHandle;
    }

    if (returnUrl) {
      properties['Shopify Product URL'] = returnUrl;
    }

    allFieldKeys.forEach((key) => {
      const field = getFieldDefinition(key);
      const value = (getFieldValue(key) || field?.value || '').trim();
      if (!value) return;
      const label = (field?.label || key).trim();
      if (properties[label]) return;
      properties[label] = value;
    });

    return properties;
  }, [allFieldKeys, effectiveProductHandle, getFieldDefinition, getFieldValue, layout.id, layout.name, returnUrl]);

  const primeProductOptions = useCallback((variants: ProductVariantOption[]) => {
    setProductOptions(variants);
    setSelectedVariant((prev) => {
      if (!variants.length) return null;
      if (prev) {
        const persisted = variants.find((variant) => variant.id === prev.id);
        if (persisted) return persisted;
      }
      return variants.find((variant) => variant.available) ?? variants[0] ?? null;
    });
  }, []);

  useEffect(() => {
    setDerivedProductHandle(null);
    setProductSource(productHandle ? 'query' : layout.shopifyProductHandle ? 'layout' : null);
  }, [layout.id, productHandle, layout.shopifyProductHandle]);

  useEffect(() => {
    if (!effectiveProductHandle) {
      setProductOptions([]);
      setProductStatus('idle');
      return;
    }
    let cancelled = false;
    const fetchProduct = async () => {
      setProductStatus('loading');
      try {
        const response = await fetchWithTimeout(`/products/${effectiveProductHandle}.js`, { credentials: 'include' });
        if (!response.ok) throw new Error('Unable to load product options');
        const json = await response.json();
        if (cancelled) return;
        const variants: ProductVariantOption[] = (json.variants || []).map((variant: any) => {
          return {
            id: Number(variant.id),
            title: variant.title,
            price: normalizeVariantPrice(variant.price),
            available: Boolean(variant.available)
          };
        });
        primeProductOptions(variants);
        setProductStatus('idle');
      } catch (error) {
        console.warn('Product option fetch failed', error);
        if (!cancelled) {
          primeProductOptions([]);
          setProductStatus('error');
        }
      }
    };
    fetchProduct();
    return () => {
      cancelled = true;
    };
  }, [effectiveProductHandle, primeProductOptions]);

  useEffect(() => {
    if (!tagLookupEnabled) return;
    if (!tagLookupActive) return;
    if (derivedProductHandle) return;
    if (baseProductHandle && productStatus !== 'error') return;
    let cancelled = false;
    const fetchByTags = async () => {
      setProductStatus('loading');
      try {
        const tagQuery = encodeURIComponent((layout.shopifyTags || []).join(','));
        const response = await fetchWithTimeout(`/api/shopify-products-by-tags?tags=${tagQuery}`, { credentials: 'include' });
        if (!response.ok) throw new Error('No Shopify product matched those tags');
        const payload = await response.json();
        if (cancelled) return;
        setDerivedProductHandle(payload.handle || null);
        setProductSource('tags');
        primeProductOptions(payload.variants || []);
        setProductStatus('idle');
      } catch (error) {
        console.warn('Tag-based product lookup failed', error);
        if (!cancelled) {
          primeProductOptions([]);
          setProductStatus('error');
        }
      }
    };
    fetchByTags();
    return () => {
      cancelled = true;
    };
  }, [baseProductHandle, derivedProductHandle, layout.shopifyTags, primeProductOptions, productStatus, tagLookupEnabled, tagLookupActive]);

  useEffect(() => {
    setFieldErrors({});
  }, [layout.id]);

  useEffect(() => {
    setPreviewSide('front');
  }, [layout.id]);

  const updateField = (key: string, value: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      if (!value.trim()) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setData((prev) => {
      if (key === 'addressLine1') {
        return { ...prev, addressLine1: value };
      }
      if (key in prev) {
        return { ...prev, [key]: value } as CardData;
      }
      return { ...prev, customValues: { ...(prev.customValues || {}), [key]: value } };
    });
  };

  const handleFormAdvance = useCallback(() => {
    if (!formFieldKeys.length) {
      setFieldErrors({});
      setStep('proof');
      return;
    }
    const missing: Record<string, boolean> = {};
    formFieldKeys.forEach((key) => {
      const field = getFieldDefinition(key);
      if (!field?.required) return;
      const currentValue = getFieldValue(key).trim();
      if (!currentValue) {
        missing[key] = true;
      }
    });
    if (Object.keys(missing).length) {
      setFieldErrors(missing);
      return;
    }
    setFieldErrors({});
    setStep('proof');
  }, [formFieldKeys, getFieldDefinition, getFieldValue]);

  const capturePreview = async (options?: { watermark?: boolean; scale?: number }) => {
    if (!proofRef.current) throw new Error('Preview unavailable');
    const canvas = await html2canvas(proofRef.current, {
      scale: options?.scale || 1.2,
      useCORS: true,
      backgroundColor: layout.front?.backgroundColor || '#ffffff'
    });
    if (options?.watermark) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.rotate(-Math.PI / 4);
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = '#ef4444';
        ctx.font = `${Math.max(canvas.width, canvas.height) / 12}px 'Inter', sans-serif`;
        for (let y = -canvas.height * 1.5; y < canvas.height * 1.5; y += 200) {
          for (let x = -canvas.width * 1.5; x < canvas.width * 1.5; x += 400) {
            ctx.fillText('PROOF', x, y);
          }
        }
        ctx.restore();
      }
    }
    return canvas;
  };

  const pdfFromCanvas = (canvas: HTMLCanvasElement, quality = 0.85) => {
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL('image/jpeg', quality), 'JPEG', 0, 0, canvas.width, canvas.height);
    return pdf;
  };

  const downloadCanvasImage = (canvas: HTMLCanvasElement, fileName: string, quality = 0.82) => {
    const anchor = document.createElement('a');
    anchor.href = canvas.toDataURL('image/jpeg', quality);
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const proofBaseName = layout.name.replace(/\s+/g, '-');

  const handleDownloadProofJpg = async () => {
    setProofStatus('generating');
    try {
      const canvas = await capturePreview({ watermark: true, scale: 1.1 });
      downloadCanvasImage(canvas, `${proofBaseName}-Proof.jpg`, 0.8);
    } catch (error) {
      console.error('Unable to export JPG proof', error);
      alert('Unable to generate proof. Please try again.');
    } finally {
      setProofStatus('idle');
    }
  };

  const handleDownloadProofPdf = async () => {
    setProofStatus('generating');
    try {
      const canvas = await capturePreview({ watermark: true, scale: 1.1 });
      const pdf = pdfFromCanvas(canvas, 0.6);
      pdf.save(`${proofBaseName}-Proof.pdf`);
    } catch (error) {
      console.error('Unable to export proof', error);
      alert('Unable to generate proof. Please try again.');
    } finally {
      setProofStatus('idle');
    }
  };

  const handleDownloadVector = () => {
    setProofStatus('generating');
    try {
      const exports = [
        { suffix: 'front', side: layout.front },
        ...(layout.back ? [{ suffix: 'back', side: layout.back }] : [])
      ];
      exports.forEach(({ suffix, side }) => {
        const svg = buildCardSvg({ side, data, settings, fontAssets: layout.fontAssets || [] });
        downloadTextFile(`${proofBaseName}-${suffix}.svg`, svg, 'image/svg+xml;charset=utf-8');
      });
    } catch (error) {
      console.error('Unable to export vector artwork', error);
      alert('Unable to generate the SVG artwork. Please try again.');
    } finally {
      setProofStatus('idle');
    }
  };

  const uploadPrintReadyPdf = async (): Promise<string | null> => {
    try {
      const canvas = await capturePreview({ watermark: false, scale: 2 });
      const pdf = pdfFromCanvas(canvas, 0.95);
      const dataUri = pdf.output('datauristring');
      const base64 = dataUri.split(',')[1];
      const response = await fetch('/api/proofs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfData: base64,
          layoutId: layout.id,
          layoutName: layout.name,
          cardData: data,
          productHandle: effectiveProductHandle,
          returnUrl,
          notificationEmail: settings.businessEmail,
          selectedVariant: selectedVariant
            ? {
                id: selectedVariant.id,
                title: selectedVariant.title,
                price: selectedVariant.price,
                available: selectedVariant.available
              }
            : null
        })
      });
      if (!response.ok) throw new Error('Upload failed');
      const payload = await response.json();
      return payload.reference ?? null;
    } catch (error) {
      console.warn('Print-ready PDF upload skipped', error);
      return null;
    }
  };

  const handleFinalizeRequest = async () => {
    if ((cartEnabled || returnUrl) && !selectedVariant) {
      alert('Select a quantity option before continuing.');
      return;
    }
    setCheckoutStatus('loading');
    try {
      const proofReference = await uploadPrintReadyPdf();
      if (cartEnabled) {
        const payload = {
          items: [
            {
              id: selectedVariant?.id,
              quantity: 1,
              properties: buildLineItemProperties(proofReference)
            }
          ]
        };
        const response = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errorPayload = await response.json().catch(() => ({}));
          throw new Error(errorPayload?.message || 'Cart endpoint unavailable');
        }
        const result = await response.json();
        onComplete(data);
        const redirectUrl = result?.checkoutUrl || result?.redirectUrl;
        if (redirectUrl) {
          window.location.href = redirectUrl;
        } else if (returnUrl) {
          returnToProductPage({
            cardify_status: 'cart_created',
            cardify_layout: layout.id,
            cardify_variant: String(selectedVariant?.id || '')
          });
        } else {
          alert('Cart created but no checkout URL was returned. Please review Shopify response.');
        }
      } else if (returnUrl && selectedVariant) {
        onComplete(data);
        const redirectUrl = buildShopifyCartPermalink({
          returnUrl,
          variantId: selectedVariant.id,
          quantity: 1,
          properties: buildLineItemProperties(proofReference)
        });
        window.location.href = redirectUrl;
        return;
      } else {
        onComplete(data);
        if (returnUrl) {
          returnToProductPage({
            cardify_status: 'approved',
            cardify_layout: layout.id,
            cardify_proof: proofReference || 'manual_review',
            cardify_variant: String(selectedVariant?.id || '')
          });
          return;
        }
        const contactEmail = settings.businessEmail || 'your print rep';
        const selectionBlurb = selectedVariant ? ` referencing ${selectedVariant.title}` : '';
        alert(`Proof approved! Share reference ${proofReference || 'manual_review'}${selectionBlurb} with ${contactEmail} to place your order.`);
      }
    } catch (error) {
      console.error(error);
      setCheckoutStatus('error');
      alert((error as Error).message || 'We were unable to finalize this request automatically.');
    } finally {
      setCheckoutStatus('idle');
    }
  };

  const formStep = (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] gap-6">
      <div className="space-y-4">
        <button onClick={onBack} className="text-slate-500 font-semibold flex items-center gap-2 text-xs uppercase tracking-[0.3em]">
          <ArrowLeft size={14} /> Back to gallery
        </button>
        <div className="bg-white border border-slate-200 rounded-[22px] p-5 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Step {getStepPosition('form')} of {totalSteps}</p>
            <h2 className="text-2xl font-black text-slate-900 mt-1">Enter card details</h2>
          </div>
          {formFieldKeys.length ? (
            <div className="space-y-3">
              {formFieldKeys.map((key) => {
                const field = getFieldDefinition(key);
                if (!field) return null;
                const value = getFieldValue(key);
                const isRequired = Boolean(field.required);
                const showError = Boolean(fieldErrors[key]);
                return (
                  <label key={key} className="text-xs font-semibold text-slate-500 uppercase tracking-[0.25em] space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        {field.label || key}
                        {isRequired && <span className="text-red-500 ml-2">*</span>}
                      </span>
                      {showError && <span className="text-[10px] text-red-500 font-black tracking-[0.3em]">Required</span>}
                    </div>
                    {ADDRESS_FIELD_KEYS.has(key) ? (
                      <AddressAutocomplete
                        value={value}
                        onChange={(val) => updateField(key, val)}
                        placeholder={field.placeholder || `Enter ${field.label || key}`}
                        hasError={showError}
                        ariaRequired={isRequired || undefined}
                        ariaInvalid={showError || undefined}
                      />
                    ) : (
                      <input
                        value={value}
                        onChange={(e) => updateField(key, e.target.value)}
                        placeholder={field.placeholder || `Enter ${field.label || key}`}
                        className={`w-full px-4 py-3 rounded-2xl text-sm font-medium text-slate-900 focus:bg-white focus:ring-4 outline-none ${showError ? 'bg-red-50 border border-red-300 focus:ring-red-200' : 'bg-slate-50 border border-slate-200 focus:ring-blue-100'}`}
                        aria-required={isRequired || undefined}
                        aria-invalid={showError || undefined}
                      />
                    )}
                    {showError && <span className="text-[10px] text-red-500 font-black tracking-[0.3em]">Please complete this field.</span>}
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl bg-slate-50 border border-dashed border-slate-200 p-4 text-sm text-slate-500">
              All visible fields are pre-filled for this layout. Continue to preview the proof.
            </div>
          )}
          {lockedFieldKeys.length > 0 && (
            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 space-y-2">
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-500">Preset details</p>
              <ul className="space-y-1 text-[11px] text-slate-600">
                {lockedFieldKeys.map((key) => (
                  <li key={key} className="flex justify-between gap-3">
                    <span className="font-semibold text-slate-400">{getFieldDefinition(key)?.label || key}</span>
                    <span className="text-slate-800">{getFieldValue(key) || getFieldDefinition(key)?.value || '—'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {Object.keys(fieldErrors).length > 0 && (
            <p className="text-[11px] text-red-500 font-black uppercase tracking-[0.3em]">Fill all required fields before continuing.</p>
          )}
          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={onBack} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-[0.3em] text-slate-500">Cancel</button>
            <button onClick={handleFormAdvance} className="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-[0.3em]">Preview Proof</button>
          </div>
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-[22px] p-5 relative lg:sticky lg:top-8 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.4em] text-slate-400">Live Preview</div>
          {hasBackSide && (
            <div className="flex gap-2 text-[10px] font-black uppercase tracking-[0.3em]">
              {(['front', 'back'] as const).map((side) => (
                <button
                  key={side}
                  onClick={() => setPreviewSide(side)}
                  className={`px-3 py-1.5 rounded-xl border ${previewSide === side ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
                >
                  {side}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4 overflow-hidden shadow-inner">
          <BusinessCardPreview data={data} scale={convertLegacyDisplayScale(1.35)} side={previewSideLayout} settings={settings} fontAssets={layout.fontAssets} />
        </div>
      </div>
    </div>
  );

  const proofStep = (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Step {getStepPosition('proof')} of {totalSteps}</p>
          <h2 className="text-2xl font-black text-slate-900 mt-1">Review & approve proof</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setStep('form')} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-[0.3em] text-slate-500">Edit Details</button>
          <button onClick={onBack} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-[0.3em] text-slate-500">Cancel</button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white border border-slate-200 rounded-[22px] p-5">
          <div className={`bg-slate-900 rounded-[20px] p-6 ${hasBackSide ? 'flex flex-col md:flex-row gap-6 overflow-x-auto' : 'flex justify-center'}`}>
            <div className="shrink-0">
              <BusinessCardPreview
                data={data}
                scale={hasBackSide ? convertLegacyDisplayScale(1.05) : convertLegacyDisplayScale(1.6)}
                side={layout.front}
                settings={settings}
                fontAssets={layout.fontAssets}
              />
            </div>
            {hasBackSide && layout.back && (
              <div className="shrink-0">
                <BusinessCardPreview
                  data={data}
                  scale={convertLegacyDisplayScale(1.05)}
                  side={layout.back}
                  settings={settings}
                  fontAssets={layout.fontAssets}
                />
              </div>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={handleDownloadProofJpg} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-[0.3em] flex items-center gap-2" disabled={proofStatus === 'generating'}>
              <Download size={14} /> {proofStatus === 'generating' ? 'Preparing...' : 'Download Proof JPG'}
            </button>
            {isAdmin && (
              <>
                <button onClick={handleDownloadProofPdf} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-[0.3em] flex items-center gap-2" disabled={proofStatus === 'generating'}>
                  <Download size={14} /> {proofStatus === 'generating' ? 'Preparing...' : 'Download Proof PDF'}
                </button>
                <button onClick={handleDownloadVector} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-[0.3em] flex items-center gap-2" disabled={proofStatus === 'generating'}>
                  <Download size={14} /> {proofStatus === 'generating' ? 'Preparing...' : 'Download Vector SVG'}
                </button>
              </>
            )}
            <button onClick={() => setShowApprovalModal(true)} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-[0.3em] flex items-center gap-2">
              <CheckCircle size={14} /> Approve Proof
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const quantityHeading = cartEnabled ? 'Select production quantity' : 'Finalize your print request';
  const canUseCartPermalinkFallback = !cartEnabled && canReturnToProduct;
  const finalizeDisabled = (cartEnabled || canUseCartPermalinkFallback)
    ? !selectedVariant || checkoutStatus === 'loading'
    : checkoutStatus === 'loading';
  const finalizeCtaLabel = cartEnabled
    ? (checkoutStatus === 'loading' ? 'Adding…' : 'Add to Cart')
    : canUseCartPermalinkFallback
      ? (checkoutStatus === 'loading' ? 'Redirecting…' : 'Add to Shopify Cart')
      : (checkoutStatus === 'loading' ? 'Preparing…' : 'Email Order Request');
  const showCartDisabledWarning = productOptions.length > 0 && !cartEnabled && !canUseCartPermalinkFallback;
  const quantityStep = (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Step {getStepPosition('quantity')} of {totalSteps}</p>
          <h2 className="text-2xl font-black text-slate-900 mt-1">{quantityHeading}</h2>
        </div>
        <button onClick={() => setStep('proof')} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-[0.3em] text-slate-500">Back to proof</button>
      </div>
      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white border border-slate-200 rounded-[22px] p-5 space-y-4">
          {!cartEnabled && !canUseCartPermalinkFallback && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Share the approved proof reference with {settings.businessEmail || 'your Theme Vault rep'} so we can invoice and queue production. Variant selections below help you specify the quantity.
            </div>
          )}
          {canUseCartPermalinkFallback && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              This store is using the Shopify cart fallback path. Your selected quantity and card details will be attached to the item, then the buyer will be returned to the Shopify cart.
            </div>
          )}
          {showCartDisabledWarning && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Shopify cart mode is off for this host. {settings.businessEmail ? 'The current setup is still in manual proof mode. ' : ''}
              {cartReason || 'Add SHOPIFY_STOREFRONT_TOKEN to the server environment and restart the app to re-enable Add to Cart.'}
            </div>
          )}
          {!effectiveProductHandle && !tagLookupActive && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Set a Shopify product handle on this layout or include ?product=HANDLE in the URL to load real inventory options.
            </div>
          )}
          {!effectiveProductHandle && tagLookupActive ? (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              Matching a Shopify product with tags: <span className="font-semibold">{layout.shopifyTags.join(', ')}</span>
            </div>
          ) : null}
          {productStatus === 'loading' && <p className="text-sm text-slate-500">Loading Shopify options…</p>}
          {productStatus === 'error' && (
            <p className="text-sm text-red-600">
              {tagLookupActive
                ? 'Unable to match a Shopify product with those tags. Confirm exactly one product shares that tag set.'
                : 'Unable to load product options from Shopify. Ensure this designer is embedded on a product page or the handle is valid.'}
            </p>
          )}
          {productOptions.length === 0 && productStatus !== 'loading' && (
            <p className="text-sm text-slate-500">No variants detected. Default quantities are unavailable until a Shopify product handle is provided.</p>
          )}
          {productSource && productOptions.length > 0 && (
            <p className="text-xs text-slate-500">
              {productSource === 'query' && 'Variants synced from the ?product= URL parameter.'}
              {productSource === 'layout' && 'Variants synced from the handle saved on this layout.'}
              {productSource === 'tags' && 'Variants auto-matched from a Shopify product that shares this layout\'s tags.'}
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {productOptions.map((variant) => (
              <button
                key={variant.id}
                onClick={() => setSelectedVariant(variant)}
                disabled={!variant.available}
                className={`border rounded-2xl p-4 text-left space-y-1 transition ${selectedVariant?.id === variant.id ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white'} ${!variant.available ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <p className="text-base font-black text-slate-900">{variant.title}</p>
                <p className="text-sm text-slate-500">{formatCurrency(variant.price)}</p>
                {!variant.available && <p className="text-xs text-red-500">Sold out</p>}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleFinalizeRequest} disabled={finalizeDisabled} className="px-6 py-3 rounded-2xl bg-slate-900 text-white text-xs font-black uppercase tracking-[0.3em]">
              {finalizeCtaLabel}
            </button>
            <button onClick={onBack} className="px-4 py-2 rounded-2xl border border-slate-200 text-xs font-black uppercase tracking-[0.3em] text-slate-500">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8 animate-fadeIn">
      {step === 'form' && formStep}
      {step === 'proof' && proofStep}
      {step === 'quantity' && quantityStep}

      {showApprovalModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[22px] p-6 max-w-lg w-full space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                <CheckCircle size={20} />
              </div>
              <div>
                <p className="text-lg font-black text-slate-900">Approve Proof</p>
                <p className="text-sm text-slate-500">Confirm spelling, contact details, and layout placement.</p>
              </div>
            </div>
            <div className="bg-slate-100 rounded-2xl p-3">
              <BusinessCardPreview data={data} scale={convertLegacyDisplayScale(1)} side={layout.front} settings={settings} fontAssets={layout.fontAssets} />
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              By approving, you confirm that all information is accurate and print-ready. Theme Vault is not responsible for any typos, missing information, or design changes requested after approval. Production begins immediately once this proof is accepted.
            </p>
            <div className="flex flex-wrap gap-2 justify-end">
              <button onClick={() => setShowApprovalModal(false)} className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-[0.3em] text-slate-500">Review Again</button>
              <button onClick={() => { setShowApprovalModal(false); setStep('quantity'); }} className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-[0.3em]">Looks Good</button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed -left-[9999px] top-0" aria-hidden ref={proofRef}>
        <div className="p-4 bg-white rounded-[20px] w-[720px] space-y-4">
          <BusinessCardPreview data={data} scale={convertLegacyDisplayScale(1.6)} side={layout.front} settings={settings} fontAssets={layout.fontAssets} />
          {layout.back && (
            <BusinessCardPreview data={data} scale={convertLegacyDisplayScale(1.6)} side={layout.back} settings={settings} fontAssets={layout.fontAssets} />
          )}
        </div>
      </div>
    </div>
  );
};

const MainLayout = () => {
  const [settings, setSettings] = useState<AppSettings>(getAppSettings());
  const [brandConfigs, setBrandConfigs] = useState<Record<string, BrandConfig>>({});
  const [layoutsHydrated, setLayoutsHydrated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(() => Boolean(safeSessionStorage?.getItem(ADMIN_AUTH_KEY)));
  const initialLayoutId = useMemo(() => getLayoutIdFromQuery(), []);
  const [flowStep, setFlowStep] = useState(() => initialLayoutId ? 2 : 1);
  const [activeLayoutId, setActiveLayoutId] = useState<string | null>(initialLayoutId);
  const [initialTagApplied, setInitialTagApplied] = useState(false);
  const [shopifyCapabilities, setShopifyCapabilities] = useState<ShopifyCapabilities>({
    productProxyEnabled: true,
    tagLookupEnabled: SHOPIFY_TAG_LOOKUP_ENABLED,
    cartEnabled: SHOPIFY_CART_ENABLED,
    productProxyReason: null,
    tagLookupReason: null,
    cartReason: null
  });
  const shopifyQueryTags = useMemo(() => getShopifyQueryTags(), []);
  const productHandle = useMemo(() => getProductHandleFromQuery(), []);
  const returnUrl = useMemo(() => getReturnUrlFromQuery(), []);
  const selectedLayout = useMemo(() => findLayoutById(brandConfigs, activeLayoutId), [brandConfigs, activeLayoutId]);
  const navigate = useNavigate();
  const handleBrandConfigsChange = useCallback((next: Record<string, BrandConfig>) => {
    setBrandConfigs(normalizeBrandConfigs(next));
  }, []);

  const loadingScreen = (
    <div className="max-w-4xl mx-auto px-6 py-20 text-center animate-fadeIn">
      <p className="text-[11px] font-black uppercase tracking-[0.35em] text-slate-400">Loading</p>
      <h2 className="mt-4 text-3xl font-black uppercase tracking-tight text-slate-900">Loading saved layouts</h2>
      <p className="mt-3 text-sm text-slate-500">Pulling your persisted card templates into the workspace.</p>
    </div>
  );

  useEffect(() => {
    if (!layoutsHydrated) return;
    persistLayouts(brandConfigs).catch((error) => {
      console.warn('Unable to persist layouts.', error);
    });
  }, [brandConfigs, layoutsHydrated]);

  useEffect(() => {
    let cancelled = false;

    const hydrateLayouts = async () => {
      try {
        const stored = await loadPersistedLayouts();
        if (cancelled) return;
        if (stored) {
          setBrandConfigs(normalizeBrandConfigs(stored));
          setLayoutsHydrated(true);
          return;
        }

        const legacyStored = getLegacyStoredLayouts();
        if (legacyStored) {
          const normalized = normalizeBrandConfigs(legacyStored);
          setBrandConfigs(normalized);
          setLayoutsHydrated(true);
          persistLayouts(normalized).catch((error) => {
            console.warn('Unable to migrate layouts into IndexedDB.', error);
          });
          if (safeLocalStorage) {
            safeLocalStorage.removeItem(LAYOUT_STORAGE_KEY);
          }
          return;
        }

        setBrandConfigs(getBaseBrandConfigs());
        setLayoutsHydrated(true);
      } catch (error) {
        console.warn('Unable to hydrate persisted layouts.', error);
        if (!cancelled) {
          setBrandConfigs(getBaseBrandConfigs());
          setLayoutsHydrated(true);
        }
      }
    };

    hydrateLayouts();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadShopifyCapabilities = async () => {
      try {
        const response = await fetch('/api/shopify-capabilities', { credentials: 'include' });
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled) return;
        setShopifyCapabilities({
          productProxyEnabled: Boolean(payload?.productProxyEnabled),
          tagLookupEnabled: Boolean(payload?.tagLookupEnabled),
          cartEnabled: Boolean(payload?.cartEnabled),
          productProxyReason: typeof payload?.productProxyReason === 'string' ? payload.productProxyReason : null,
          tagLookupReason: typeof payload?.tagLookupReason === 'string' ? payload.tagLookupReason : null,
          cartReason: typeof payload?.cartReason === 'string' ? payload.cartReason : null
        });
      } catch (error) {
        console.warn('Unable to load Shopify capabilities.', error);
      }
    };

    loadShopifyCapabilities();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (flowStep === 2 && !selectedLayout) {
      setFlowStep(1);
      setActiveLayoutId(null);
    }
  }, [flowStep, selectedLayout]);

  useEffect(() => {
    if (!shopifyQueryTags.length) return;
    if (flowStep !== 1) return;
    if (!initialTagApplied) {
      setInitialTagApplied(true);
    }
  }, [flowStep, initialTagApplied, shopifyQueryTags]);

  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        navigate('/admin');
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [navigate]);

  const handleSettingsPersist = useCallback((next: AppSettings) => {
    setSettings(next);
    if (!safeLocalStorage) return;
    try {
      safeLocalStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn('Unable to persist settings.', error);
    }
  }, []);

  const handleLogin = (pass: string) => {
    if (pass === 'admin123') {
      safeSessionStorage?.setItem(ADMIN_AUTH_KEY, 'true');
      setIsAdmin(true);
      return true;
    }
    return false;
  };

  const handleLogout = () => {
    safeSessionStorage?.removeItem(ADMIN_AUTH_KEY);
    setIsAdmin(false);
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col selection:bg-blue-500 selection:text-white">
      <nav className="bg-white/90 backdrop-blur-2xl border-b border-slate-200 px-6 py-4 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <Link to="/" onClick={() => setFlowStep(1)} className="flex items-center gap-4 group">
            <div className="w-14 h-14 bg-slate-900 rounded-[22px] flex items-center justify-center text-white transition-all group-hover:rotate-12 shadow-xl group-hover:scale-110" style={{ backgroundColor: settings.primaryColor }}>
              <Layers size={30} />
            </div>
            <div>
              <span className="text-2xl font-black uppercase tracking-tighter block leading-none">{settings.appName}</span>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.5em] block mt-1.5 ml-1">Print Infrastructure</span>
            </div>
          </Link>
          {isAdmin && (
            <div className="flex items-center gap-6">
              <Link to="/admin" className="text-[11px] font-black uppercase tracking-[0.28em] flex items-center gap-2.5 hover:text-blue-600 transition-colors"><Settings size={16}/> Management</Link>
              <button onClick={handleLogout} className="text-[11px] font-black uppercase tracking-[0.28em] text-red-500 flex items-center gap-2.5 hover:text-red-600 transition-colors"><LogOut size={16}/> Terminate</button>
            </div>
          )}
        </div>
      </nav>

      <main className="flex-1">
        <Routes>
          <Route path="/" element={
            !layoutsHydrated ? loadingScreen : flowStep === 2 && selectedLayout ? (
              <CustomizerScreen
                layout={selectedLayout}
                onBack={() => setFlowStep(1)}
                onComplete={() => undefined}
                settings={settings}
                productHandle={productHandle}
                returnUrl={returnUrl}
                cartEnabled={shopifyCapabilities.cartEnabled}
                cartReason={shopifyCapabilities.cartReason}
                tagLookupEnabled={shopifyCapabilities.tagLookupEnabled}
                isAdmin={isAdmin}
              />
            ) : (
              <SelectionScreen onNext={(l) => { setActiveLayoutId(l.id); setFlowStep(2); }} settings={settings} brandConfigs={brandConfigs} activeTags={shopifyQueryTags} />
            )
          } />
          <Route path="/admin/*" element={
            <AdminGuard isAdmin={isAdmin} onLogin={handleLogin} settings={settings}>
              {!layoutsHydrated ? loadingScreen : <div className="max-w-[1500px] mx-auto px-6 py-6 space-y-6 animate-fadeIn">
                <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter">Vault Control</h1>
                    <p className="text-slate-500 font-bold text-sm md:text-base mt-2">Layouts, palettes, and production metadata in one compact workspace.</p>
                  </div>
                  <div className="flex flex-wrap gap-4 text-[11px] font-black uppercase tracking-[0.32em] text-slate-400">
                    <span>Brands: {Object.keys(brandConfigs).length}</span>
                    <span>|</span>
                    <span>Layouts: {Object.values(brandConfigs).reduce((total, cfg) => total + cfg.layouts.length, 0)}</span>
                  </div>
                </div>
                <AdminDashboard
                  brandConfigs={brandConfigs}
                  onBrandConfigsChange={handleBrandConfigsChange}
                  settings={settings}
                  onSettingsChange={handleSettingsPersist}
                />
              </div>}
            </AdminGuard>
          } />
        </Routes>
      </main>
      
      <footer className="bg-slate-900 py-20 px-12 border-t border-slate-800">
         <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-12">
            <div className="flex items-center gap-6 text-white/30">
               <Layers size={32} />
               <div className="h-8 w-px bg-white/10" />
               <span className="text-[11px] font-black uppercase tracking-[0.5em]">© {new Date().getFullYear()} Theme Vault Designer</span>
            </div>
            <div className="flex gap-12">
               <span className="text-[11px] font-black uppercase tracking-[0.5em] text-white/10">End-to-End Encryption</span>
               <span className="text-[11px] font-black uppercase tracking-[0.5em] text-white/10">Build v2.1.0</span>
            </div>
         </div>
      </footer>
    </div>
  );
};

const App = () => (
  <HashRouter>
    <MainLayout />
  </HashRouter>
);

export default App;
