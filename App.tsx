import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
import { CardData, Layout, AppSettings, BrandConfig, ColorPreset, SideLayout, FieldStyle, FontAsset, CMYK, PhoneNumberEntry, PhoneNumberTypeOption } from './types';
import { BRAND_CONFIGS } from './constants';
import { CARD_CANVAS_VERSION, CARD_HEIGHT, CARD_WIDTH, convertLegacyDisplayScale, normalizeFieldStyle } from './cardCanvas';
import { loadPersistedLayouts, persistLayouts } from './persistence';
import BusinessCardPreview from './components/BusinessCardPreview';
import AdminDashboard from './components/AdminDashboard';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import 'svg2pdf.js';
import { PDFDocument, StandardFonts, cmyk as pdfCmyk, rgb as pdfRgb, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { cmykToHex, cmykToRgb, hexToCmyk, hexToRgb, normalizeCmyk, normalizeHex, normalizeRgb, rgbToCmyk } from './utils/color';
import { pixelsToPoints } from './cardCanvas';
import { buildCardSvg } from './utils/vectorExport';
import { 
  ChevronRight, ArrowLeft, Search, Layers, Lock, LogOut, Settings, Download, CheckCircle
} from 'lucide-react';

const SETTINGS_KEY = 'theme-vault-settings';
const LAYOUT_STORAGE_KEY = 'theme-vault-layouts';
const SHOPIFY_CART_ENABLED = import.meta.env?.VITE_ENABLE_SHOPIFY_CART === 'true';
const SHOPIFY_CART_ID_STORAGE_KEY = 'theme-vault-shopify-cart-id';
const SHOPIFY_TAG_LOOKUP_ENABLED = import.meta.env?.VITE_ENABLE_SHOPIFY_TAG_LOOKUP === 'true';
const isBrowser = typeof window !== 'undefined';
const safeLocalStorage = isBrowser ? window.localStorage : null;
const safeSessionStorage = isBrowser ? window.sessionStorage : null;

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

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

const normalizePhoneNumberConfig = (layout: Layout) => {
  const baseAllowedTypes = layout.phoneNumberConfig?.allowedTypes || [];
  const normalizedAllowedTypes = baseAllowedTypes.map((option) => ({
    ...option,
    code: String(option.code || option.value?.charAt(0) || '').toUpperCase()
  }));

  return {
    maxPhones: Math.max(1, Number(layout.phoneNumberConfig?.maxPhones || 1)),
    allowedTypes: normalizedAllowedTypes,
    variationPrefix: String(layout.phoneNumberConfig?.variationPrefix || '').trim().toUpperCase(),
    variantGroupId: String(layout.phoneNumberConfig?.variantGroupId || '').trim().toLowerCase()
  };
};

const normalizeLayout = (layout: Layout): Layout => {
  const normalizedBackFields = layout.back ? normalizeFields(layout.back.fields, layout.canvasVersion) : undefined;
  if (normalizedBackFields) {
    const backFieldKeys = Object.keys(normalizedBackFields);
    if (backFieldKeys.length === 1 && backFieldKeys[0] === 'backText' && normalizedBackFields.backText?.showInForm === false) {
      normalizedBackFields.backText = {
        ...normalizedBackFields.backText,
        showInForm: true
      };
    }
  }

  return {
    ...layout,
    canvasVersion: CARD_CANVAS_VERSION,
    customerVisible: layout.customerVisible !== false,
    shopifyProductHandle: layout.shopifyProductHandle || '',
    phoneNumberConfig: normalizePhoneNumberConfig(layout),
    front: {
      ...layout.front,
      fields: normalizeFields(layout.front.fields, layout.canvasVersion),
      fieldOrder: Array.isArray(layout.front.fieldOrder) && layout.front.fieldOrder.length ? layout.front.fieldOrder : Object.keys(layout.front.fields)
    },
    back: layout.back ? {
      ...layout.back,
      fields: normalizedBackFields || normalizeFields(layout.back.fields, layout.canvasVersion),
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

const AdminGuard = ({ children, isAdmin, authReady, onLogin, settings }: { children?: React.ReactNode, isAdmin: boolean, authReady: boolean, onLogin: (p: string) => Promise<boolean>, settings: AppSettings }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 animate-fadeIn">
        <div className="w-full max-w-md bg-white p-12 rounded-[48px] shadow-2xl border border-slate-100 text-center">
          <p className="text-xs font-black uppercase tracking-[0.35em] text-slate-400">Loading Admin</p>
        </div>
      </div>
    );
  }

  if (isAdmin) return <>{children}</>;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 animate-fadeIn">
      <div className="w-full max-w-md space-y-8 bg-white p-12 rounded-[48px] shadow-2xl border border-slate-100 text-center">
        <div className="w-20 h-20 bg-slate-900 rounded-3xl flex items-center justify-center text-white mx-auto mb-6 shadow-xl" style={{ backgroundColor: settings.primaryColor }}>
          <Lock size={40} />
        </div>
        <h2 className="text-4xl font-black text-slate-900 uppercase tracking-tighter">Vault Admin</h2>
        <form onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          const ok = await onLogin(password);
          setError(!ok);
          setSubmitting(false);
        }} className="space-y-6">
          <input 
            type="password" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            className="w-full p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center font-bold text-2xl outline-none focus:ring-4 focus:ring-blue-500/10 transition-all"
            placeholder="ACCESS CODE"
            autoFocus
          />
          {error && <p className="text-xs text-red-500 font-black uppercase tracking-widest">Unauthorized Access</p>}
          <button type="submit" disabled={submitting} className="w-full py-6 rounded-2xl text-white font-black uppercase tracking-[0.2em] shadow-xl hover:opacity-90 active:scale-[0.98] transition-all text-lg disabled:opacity-60" style={{ backgroundColor: settings.primaryColor }}>
            {submitting ? 'Unlocking…' : 'Unlock Dashboard'}
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

const createInitialCardData = (layout: Layout, phoneNumbers: PhoneNumberEntry[] = []): CardData => {
  const initialPhoneNumbers = phoneNumbers.length
    ? phoneNumbers
    : (layout.phoneNumberConfig?.maxPhones || 0) > 0
      ? [{ type: layout.phoneNumberConfig?.allowedTypes[0]?.value || 'Telephone', value: '' }]
      : [];
  const primaryPhone = initialPhoneNumbers.find((entry) => String(entry.value || '').trim())?.value || '';
  const mobilePhone = initialPhoneNumbers.find((entry) => ['Mobile', 'Cell'].includes(String(entry.type || '')))?.value || '';

  return {
    brand: layout.brand,
    layoutId: layout.id,
    name: '',
    jobTitle: '',
    email: '',
    phone: primaryPhone,
    mobile: mobilePhone,
    addressLine1: '',
    website: '',
    phoneNumbers: initialPhoneNumbers,
    customValues: {}
  };
};

const buildPhoneSetupEntries = (allowedTypes: PhoneNumberTypeOption[], count: number) => {
  const fallbackType = allowedTypes[0]?.value || 'Telephone';
  return Array.from({ length: Math.max(0, count) }, () => ({ type: fallbackType, value: '' }));
};

const getPhoneSetupSignature = (entries: PhoneNumberEntry[], allowedTypes: PhoneNumberTypeOption[]) => {
  const codeMap = new Map(allowedTypes.map((option) => [option.value, option.code || option.value.charAt(0).toUpperCase()]));
  return entries
    .map((entry) => codeMap.get(entry.type) || entry.type.charAt(0).toUpperCase())
    .join('')
    .trim()
    .toUpperCase();
};

  const sanitizePhoneDigits = (value: string) => value.replace(/\D+/g, '');

const resolvePhoneSetupLayout = (selectedLayout: Layout, entries: PhoneNumberEntry[], count: number, brandConfigs: Record<string, BrandConfig>) => {
  const allLayouts = Object.values(brandConfigs).flatMap((config) => config.layouts);
  const selectedGroupId = String(selectedLayout.phoneNumberConfig?.variantGroupId || '').trim().toLowerCase();
  const groupPool = selectedGroupId
    ? allLayouts.filter((layout) => String(layout.phoneNumberConfig?.variantGroupId || '').trim().toLowerCase() === selectedGroupId)
    : allLayouts;
  const matches = groupPool.filter((layout) => (layout.phoneNumberConfig?.maxPhones || 0) >= count);
  const sameBrand = matches.filter((layout) => String(layout.brand) === String(selectedLayout.brand));
  const sameTags = (candidate: Layout) => {
    const selectedTags = new Set((selectedLayout.shopifyTags || []).map((tag) => tag.toLowerCase()));
    return (candidate.shopifyTags || []).some((tag) => selectedTags.has(tag.toLowerCase()));
  };
  const selectedPrefix = getPhoneSetupSignature(entries, selectedLayout.phoneNumberConfig?.allowedTypes || []);

  const samePrefix = (candidate: Layout) => String(candidate.phoneNumberConfig?.variationPrefix || '').trim().toUpperCase() === selectedPrefix;

  const prioritized = [
    ...sameBrand.filter((layout) => sameTags(layout) && samePrefix(layout)),
    ...sameBrand.filter(samePrefix),
    ...sameBrand.filter(sameTags),
    ...sameBrand,
    ...matches.filter((layout) => layout.id !== selectedLayout.id && sameTags(layout) && samePrefix(layout)),
    ...matches.filter((layout) => layout.id !== selectedLayout.id && samePrefix(layout)),
    ...matches.filter((layout) => layout.id !== selectedLayout.id && sameTags(layout)),
    ...matches
  ].filter((layout, index, array) => array.findIndex((item) => item.id === layout.id) === index);

  return prioritized[0] || selectedLayout;
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

const getSelectionPreviewImage = (layout: Layout) => {
  return layout.front.previewImage || layout.previewImage;
};

const PhoneNumberSetupModal = ({
  layout,
  count,
  entries,
  maxCount,
  onCountChange,
  onEntryChange,
  onCancel,
  onConfirm,
  resolveMessage
}: {
  layout: Layout;
  count: number;
  entries: PhoneNumberEntry[];
  maxCount: number;
  onCountChange: (count: number) => void;
  onEntryChange: (index: number, next: PhoneNumberEntry) => void;
  onCancel: () => void;
  onConfirm: () => void;
  resolveMessage: string;
}) => {
  const allowedTypes = layout.phoneNumberConfig?.allowedTypes || [];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[32px] bg-white p-6 shadow-2xl border border-slate-100 space-y-5 animate-fadeIn">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.35em] text-slate-400">Phone setup</p>
          <h3 className="mt-2 text-3xl font-black text-slate-900 uppercase tracking-tight">How many phone numbers?</h3>
          <p className="mt-2 text-sm text-slate-500">Choose the number of phone slots and assign each one a type. The app will use that setup to pick the best matching layout.</p>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
            <label className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Phone Count</label>
            <select
              value={count}
              onChange={(event) => onCountChange(Number(event.target.value))}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:ring-4 focus:ring-blue-500/10"
            >
              {Array.from({ length: Math.max(1, maxCount) }, (_, index) => index + 1).map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            {Array.from({ length: count }, (_, index) => {
              const entry = entries[index] || { type: allowedTypes[0]?.value || 'Telephone', value: '' };
              return (
                <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center">
                  <label className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Line {index + 1}</label>
                  <select
                    value={entry.type}
                    onChange={(event) => onEntryChange(index, { ...entry, type: event.target.value })}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none focus:ring-4 focus:ring-blue-500/10"
                  >
                    {allowedTypes.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            {resolveMessage}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3">
          <button onClick={onCancel} className="rounded-2xl border border-slate-200 px-5 py-3 text-[11px] font-black uppercase tracking-[0.3em] text-slate-500">Cancel</button>
          <button onClick={onConfirm} className="rounded-2xl bg-slate-900 px-5 py-3 text-[11px] font-black uppercase tracking-[0.3em] text-white">Use Layout</button>
        </div>
      </div>
    </div>
  );
};

const SelectionScreen = ({ onNext, settings, brandConfigs, activeTags }: { onNext: (l: Layout) => void, settings: AppSettings, brandConfigs: Record<string, BrandConfig>, activeTags: string[] }) => {
  const [search, setSearch] = useState('');
  const allLayouts = useMemo(() => Object.values(brandConfigs).flatMap(bc => bc.layouts).filter((layout) => layout.customerVisible !== false), [brandConfigs]);
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
                {getSelectionPreviewImage(l) ? (
                  <img src={getSelectionPreviewImage(l)} alt={l.name} className="block w-full h-full object-cover" />
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
  onFocus?: () => void;
  placeholder?: string;
  hasError?: boolean;
  ariaRequired?: boolean;
  ariaInvalid?: boolean;
}> = ({ value, onChange, onFocus, placeholder, hasError, ariaRequired, ariaInvalid }) => {
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
        onFocus={() => {
          onFocus?.();
          if (suggestions.length) setOpen(true);
        }}
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

const buildShopifyCartAddUrl = ({
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
  const params = new URLSearchParams({
    id: String(variantId),
    quantity: String(Math.max(1, quantity)),
    storefront: 'true',
    return_to: '/cart'
  });
  const propertyEntries = Object.entries(properties)
    .filter(([, value]) => String(value || '').trim())
    .slice(0, 25);

  propertyEntries.forEach(([key, value]) => {
    params.set(`properties[${key}]`, String(value));
  });

  return `${parsed.origin}/cart/add?${params.toString()}`;
};

const PRODUCT_REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_PROOF_BASE_URL = 'https://bcard-creator.onrender.com';
const PRINT_CARD_WIDTH_IN = 3.5;
const PRINT_CARD_HEIGHT_IN = 2;
const PRINT_BLEED_IN = 0.125;
const PRINT_PAGE_WIDTH_IN = PRINT_CARD_WIDTH_IN + PRINT_BLEED_IN * 2;
const PRINT_PAGE_HEIGHT_IN = PRINT_CARD_HEIGHT_IN + PRINT_BLEED_IN * 2;
const POINTS_PER_INCH = 72;
const PRINT_CARD_WIDTH_PT = PRINT_CARD_WIDTH_IN * POINTS_PER_INCH;
const PRINT_CARD_HEIGHT_PT = PRINT_CARD_HEIGHT_IN * POINTS_PER_INCH;
const PRINT_BLEED_PT = PRINT_BLEED_IN * POINTS_PER_INCH;
const PRINT_PAGE_WIDTH_PT = PRINT_PAGE_WIDTH_IN * POINTS_PER_INCH;
const PRINT_PAGE_HEIGHT_PT = PRINT_PAGE_HEIGHT_IN * POINTS_PER_INCH;
const SIDE_VALUE_PREFIX = '__side__';

type CardSide = 'front' | 'back';

interface SideFieldRef {
  id: string;
  side: CardSide;
  key: string;
}

const SIDE_AWARE_NATIVE_KEYS = new Set(['name', 'jobTitle', 'email', 'phone', 'mobile', 'addressLine1', 'website']);

const toSideValueKey = (side: CardSide, key: string) => `${SIDE_VALUE_PREFIX}${side}:${key}`;

interface SvgTextLine {
  text: string;
  topPx: number;
}

interface SvgTextRun {
  xPx: number;
  fontSizePx: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  anchor: 'left' | 'center' | 'right';
  cmyk: CMYK | null;
  rgbHex?: string;
  lines: SvgTextLine[];
}

const normalizeUploadedFontName = (name: string) => {
  const cleaned = name.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
  const canonical = cleaned.replace(/(?:[_-])\d{3,}$/g, '').trim();
  return canonical.toLowerCase();
};

const dataUrlToBytes = (dataUrl: string): Uint8Array => {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
};

const renderPdfBytesToPreviewImages = async (pdfBytes: Uint8Array): Promise<{ front: string | null; back: string | null }> => {
  let loadingTask: ReturnType<typeof getDocument> | null = null;
  let pdfDoc: Awaited<ReturnType<ReturnType<typeof getDocument>['promise']>> | null = null;

  const renderPageAtIndex = async (pageIndex: number) => {
    if (!pdfDoc || pdfDoc.numPages < pageIndex) return null;
    const page = await pdfDoc.getPage(pageIndex);
    const viewportBase = page.getViewport({ scale: 1 });
    const includesBleed = viewportBase.width > PRINT_CARD_WIDTH_PT + 0.5 || viewportBase.height > PRINT_CARD_HEIGHT_PT + 0.5;
    const scale = CARD_WIDTH / Math.max(1, PRINT_CARD_WIDTH_PT);
    const viewport = page.getViewport({ scale });

    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = CARD_WIDTH;
    pageCanvas.height = CARD_HEIGHT;
    const pageCtx = pageCanvas.getContext('2d');
    if (!pageCtx) return null;

    pageCtx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = Math.max(1, Math.round(viewport.width));
    tempCanvas.height = Math.max(1, Math.round(viewport.height));
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;

    await page.render({ canvasContext: tempCtx, viewport }).promise;

    if (includesBleed) {
      const trimX = Math.max(0, PRINT_BLEED_PT * scale);
      const trimY = Math.max(0, PRINT_BLEED_PT * scale);
      const trimWidth = Math.min(tempCanvas.width - trimX, PRINT_CARD_WIDTH_PT * scale);
      const trimHeight = Math.min(tempCanvas.height - trimY, PRINT_CARD_HEIGHT_PT * scale);
      pageCtx.drawImage(tempCanvas, trimX, trimY, trimWidth, trimHeight, 0, 0, CARD_WIDTH, CARD_HEIGHT);
    } else {
      pageCtx.drawImage(tempCanvas, 0, 0, CARD_WIDTH, CARD_HEIGHT);
    }
    try {
      page.cleanup?.();
    } catch {
      // Ignore cleanup failures from PDF.js internals.
    }

    return pageCanvas.toDataURL('image/png');
  };

  try {
    loadingTask = getDocument({ data: pdfBytes });
    pdfDoc = await loadingTask.promise;
    return {
      front: await renderPageAtIndex(1),
      back: await renderPageAtIndex(2)
    };
  } finally {
    try {
      pdfDoc?.cleanup?.();
    } catch {
      // Ignore cleanup failures from PDF.js internals.
    }
    try {
      loadingTask?.destroy?.();
    } catch {
      // Ignore cleanup failures from PDF.js internals.
    }
  }
};

const extractSvgTextRuns = (svgMarkup: string): SvgTextRun[] => {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(svgMarkup, 'image/svg+xml');
  
  // Handle <g> wrappers from buildCardSvg and look for text inside
  const groupElements = Array.from(parsed.querySelectorAll('g[data-field-key]'));
  const directTextElements = Array.from(parsed.querySelectorAll('svg > text'));
  const textElements = [
    ...directTextElements,
    ...groupElements.flatMap(g => Array.from(g.querySelectorAll('text')))
  ].filter((el, idx, arr) => arr.indexOf(el) === idx); // dedup

  const runs: SvgTextRun[] = [];

  textElements.forEach((textElement) => {
    const style = parseCssStyleString(textElement.getAttribute('style'));
    const xPx = Number(textElement.getAttribute('x') || '0');
    const yPx = Number(textElement.getAttribute('y') || '0');
    const fontSizePx = Number((style['font-size'] || '16').replace(/px/i, '').trim()) || 16;
    const lineHeightPx = fontSizePx * 1.25;
    const anchorRaw = (style['text-anchor'] || 'start').toLowerCase();
    const anchor = anchorRaw === 'middle' ? 'center' : anchorRaw === 'end' ? 'right' : 'left';
    const cmyk = parsePrintCmykLabel(textElement.getAttribute('data-print-cmyk')) || hexToCmyk(style.fill || undefined);

    const tspans = Array.from(textElement.querySelectorAll('tspan'));
    const lines: SvgTextLine[] = [];

    if (!tspans.length) {
      const directText = Array.from(textElement.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim())
        .map((node) => (node.textContent || '').trim())
        .filter(Boolean)
        .join('');

      if (directText) {
        lines.push({ text: directText, topPx: yPx });
      }

      if (!lines.length && textElement.textContent?.trim()) {
        lines.push({ text: textElement.textContent.trim(), topPx: yPx });
      }
    } else {
      let currentTop = yPx;
      tspans.forEach((tspan, tidx) => {
        const dyAttr = tspan.getAttribute('dy');
        const dy = dyAttr ? Number(dyAttr) : (tidx === 0 ? 0 : lineHeightPx);
        if (tidx > 0) currentTop += dy;
        const tspanText = (tspan.textContent || '').trim();
        if (tspanText) {
          lines.push({ text: tspanText, topPx: currentTop });
        }
      });
    }

    if (lines.length) {
      runs.push({
        xPx,
        fontSizePx,
        fontFamily: style['font-family'] || 'helvetica',
        fontWeight: style['font-weight'] || '400',
        fontStyle: style['font-style'] || 'normal',
        anchor,
        cmyk,
        rgbHex: style.fill,
        lines
      });
    }
  });

  return runs;
};

const resolvePdfLibFont = async (
  pdfDoc: PDFDocument,
  fontMap: Map<string, PDFFont>,
  fontFamilyRaw: string,
  fontWeightRaw: string,
  fontStyleRaw: string
) => {
  const normalizedFamily = normalizeFontFamilyKey(fontFamilyRaw || '');
  const uploaded = fontMap.get(normalizedFamily);
  if (uploaded) return uploaded;

  const isSerif = normalizedFamily.includes('serif') || normalizedFamily.includes('playfair') || normalizedFamily.includes('georgia');
  const numericWeight = Number(fontWeightRaw || '400');
  const isBold = Number.isFinite(numericWeight) ? numericWeight >= 700 : /bold|black|heavy|semibold/i.test(fontWeightRaw || '');
  const isItalic = (fontStyleRaw || '').toLowerCase().includes('italic');

  if (isSerif) {
    if (isBold && isItalic) return pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic);
    if (isBold) return pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    if (isItalic) return pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
    return pdfDoc.embedFont(StandardFonts.TimesRoman);
  }

  if (isBold && isItalic) return pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);
  if (isBold) return pdfDoc.embedFont(StandardFonts.HelveticaBold);
  if (isItalic) return pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  return pdfDoc.embedFont(StandardFonts.Helvetica);
};

const drawSvgTextRunsOnPdfPage = async (
  pdfDoc: PDFDocument,
  page: any,
  runs: SvgTextRun[],
  fontMap: Map<string, PDFFont>,
  pageWidth: number,
  pageHeight: number,
  contentBox?: { x: number; y: number; width: number; height: number }
) => {
  const renderBox = contentBox || { x: 0, y: 0, width: pageWidth, height: pageHeight };
  const scaleX = renderBox.width / CARD_WIDTH;
  const scaleY = renderBox.height / CARD_HEIGHT;

  for (const run of runs) {
    const font = await resolvePdfLibFont(pdfDoc, fontMap, run.fontFamily, run.fontWeight, run.fontStyle);
    const fontSizePt = run.fontSizePx * scaleY;

    for (const line of run.lines) {
      const text = line.text || ' ';
      const width = font.widthOfTextAtSize(text, fontSizePt);
      const anchorX = renderBox.x + run.xPx * scaleX;
      const x = run.anchor === 'center' ? anchorX - width / 2 : run.anchor === 'right' ? anchorX - width : anchorX;
      const y = pageHeight - (renderBox.y + (line.topPx * scaleY) + fontSizePt);

      const color = run.cmyk
        ? pdfCmyk(run.cmyk.c / 100, run.cmyk.m / 100, run.cmyk.y / 100, run.cmyk.k / 100)
        : (() => {
            const rgb = hexToRgb(run.rgbHex);
            if (!rgb) return undefined;
            return pdfRgb(rgb.r / 255, rgb.g / 255, rgb.b / 255);
          })();

      page.drawText(text, {
        x,
        y,
        size: fontSizePt,
        font,
        color
      });
    }
  }
};

const registerEmbeddedPrintFonts = async (pdfDoc: PDFDocument, fontAssets: FontAsset[]) => {
  const fontMap = new Map<string, PDFFont>();
  pdfDoc.registerFontkit(fontkit);

  for (const asset of fontAssets) {
    if (!asset?.name || !asset?.dataUrl) continue;
    if (!['truetype', 'opentype'].includes(asset.format)) continue;

    try {
      const fontBytes = dataUrlToBytes(asset.dataUrl);
      const embedded = await pdfDoc.embedFont(fontBytes, { subset: false });
      const normalizedUploadedName = normalizeUploadedFontName(asset.name);
      fontMap.set(normalizedUploadedName, embedded);
      fontMap.set(normalizeFontFamilyKey(asset.name), embedded);
    } catch (error) {
      console.warn('Unable to embed uploaded font in print PDF', asset.name, error);
    }
  }

  return fontMap;
};

const getSideTemplatePdfDataUrl = (side: SideLayout): string | null => {
  if (side.backgroundPdf?.startsWith('data:application/pdf')) return side.backgroundPdf;
  if (side.backgroundImage?.startsWith('data:application/pdf')) return side.backgroundImage;
  return null;
};

const pxToPrintPt = (px: number) => (px * 72) / 300;
const pxToIn = (px: number) => px / 300;

const parseCssStyleString = (styleValue?: string | null) => {
  return (styleValue || '')
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, declaration) => {
      const separator = declaration.indexOf(':');
      if (separator === -1) return acc;
      const key = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration.slice(separator + 1).trim();
      if (!key) return acc;
      acc[key] = value;
      return acc;
    }, {});
};

const parsePrintCmykLabel = (label?: string | null): CMYK | null => {
  if (!label) return null;
  const match = label.match(/C\s*(\d+)\s*M\s*(\d+)\s*Y\s*(\d+)\s*K\s*(\d+)/i);
  if (!match) return null;
  return normalizeCmyk({
    c: Number(match[1]),
    m: Number(match[2]),
    y: Number(match[3]),
    k: Number(match[4])
  });
};

const normalizeFontFamilyKey = (fontFamily: string) => {
  const primary = fontFamily.split(',')[0] || fontFamily;
  const cleaned = primary.replace(/['"]/g, '').trim();
  const canonical = cleaned.replace(/(?:[_-])\d{3,}$/g, '').trim();
  return canonical.toLowerCase();
};

const registerPdfFonts = (pdf: jsPDF, fontAssets: FontAsset[]) => {
  const registered = new Map<string, string>();

  fontAssets.forEach((asset) => {
    if (!asset?.name || !asset?.dataUrl) return;
    if (!['truetype', 'opentype'].includes(asset.format)) return;
    const base64 = asset.dataUrl.split(',')[1];
    if (!base64) return;

    const safeId = (asset.id || asset.name).replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `font-${safeId}.ttf`;
    const pdfFontName = `CardFont_${safeId}`;

    try {
      pdf.addFileToVFS(fileName, base64);
      pdf.addFont(fileName, pdfFontName, 'normal');
      registered.set(normalizeFontFamilyKey(asset.name), pdfFontName);
    } catch (error) {
      console.warn('Unable to register print font asset', asset.name, error);
    }
  });

  return registered;
};

const stripSvgTextPaint = (svgMarkup: string) => {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(svgMarkup, 'image/svg+xml');
  const serializer = new XMLSerializer();
  const textNodes = Array.from(parsed.querySelectorAll('text'));

  textNodes.forEach((node) => {
    const style = parseCssStyleString(node.getAttribute('style'));
    style.fill = 'transparent';
    const rebuiltStyle = Object.entries(style).map(([key, value]) => `${key}:${value}`).join(';');
    node.setAttribute('style', rebuiltStyle);
    node.setAttribute('fill', 'transparent');
    node.setAttribute('opacity', '0');
  });

  return serializer.serializeToString(parsed.documentElement);
};

const resolvePdfFont = (
  fontFamilyRaw: string,
  fontWeightRaw: string,
  fontStyleRaw: string,
  registeredFonts: Map<string, string>
) => {
  const key = normalizeFontFamilyKey(fontFamilyRaw || '');
  const custom = registeredFonts.get(key);
  if (custom) {
    return { fontName: custom, fontStyle: 'normal' as const };
  }

  const isSerif = key.includes('serif') || key.includes('playfair') || key.includes('georgia');
  const fontName = isSerif ? 'times' : 'helvetica';
  const numericWeight = Number(fontWeightRaw || '400');
  const isBold = Number.isFinite(numericWeight) ? numericWeight >= 700 : /bold|black|heavy|semibold/i.test(fontWeightRaw || '');
  const isItalic = (fontStyleRaw || '').toLowerCase().includes('italic');

  if (isBold && isItalic) return { fontName, fontStyle: 'bolditalic' as const };
  if (isBold) return { fontName, fontStyle: 'bold' as const };
  if (isItalic) return { fontName, fontStyle: 'italic' as const };
  return { fontName, fontStyle: 'normal' as const };
};

const applyPdfCmykTextColor = (pdf: jsPDF, cmyk: CMYK | null, fallbackFill?: string) => {
  if (cmyk) {
    pdf.setTextColor(
      (cmyk.c / 100).toFixed(3) as unknown as number,
      (cmyk.m / 100).toFixed(3) as unknown as number,
      (cmyk.y / 100).toFixed(3) as unknown as number,
      (cmyk.k / 100).toFixed(3) as unknown as number
    );
    return;
  }
  pdf.setTextColor(fallbackFill || '#000000');
};

const overlaySvgTextForPrint = (pdf: jsPDF, svgMarkup: string, registeredFonts: Map<string, string>) => {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(svgMarkup, 'image/svg+xml');
  const textElements = Array.from(parsed.querySelectorAll('text'));

  textElements.forEach((textElement) => {
    const style = parseCssStyleString(textElement.getAttribute('style'));
    const xPx = Number(textElement.getAttribute('x') || '0');
    const yPx = Number(textElement.getAttribute('y') || '0');
    const fontSizePx = Number((style['font-size'] || '16').replace(/px/i, '').trim()) || 16;
    const fontFamily = style['font-family'] || 'helvetica';
    const fontWeight = style['font-weight'] || '400';
    const fontStyle = style['font-style'] || 'normal';
    const textAnchor = (style['text-anchor'] || 'start').toLowerCase();
    const fillColor = style.fill;
    const cmyk = parsePrintCmykLabel(textElement.getAttribute('data-print-cmyk')) || hexToCmyk(fillColor);
    const { fontName, fontStyle: resolvedFontStyle } = resolvePdfFont(fontFamily, fontWeight, fontStyle, registeredFonts);
    const align = textAnchor === 'middle' ? 'center' : textAnchor === 'end' ? 'right' : 'left';

    pdf.setFont(fontName, resolvedFontStyle);
    pdf.setFontSize(pxToPrintPt(fontSizePx));
    applyPdfCmykTextColor(pdf, cmyk, fillColor);

    const tspans = Array.from(textElement.querySelectorAll('tspan'));
    if (!tspans.length) {
      const raw = textElement.textContent || '';
      const content = raw.length ? raw : ' ';
      const baselinePx = yPx + fontSizePx * 0.82;
      pdf.text(content, pxToIn(xPx), pxToIn(baselinePx), { align });
      return;
    }

    let currentYpx = yPx;
    tspans.forEach((tspan, index) => {
      const dyPx = Number(tspan.getAttribute('dy') || (index === 0 ? '0' : `${fontSizePx * 1.25}`));
      if (index > 0) currentYpx += dyPx;
      const raw = tspan.textContent || '';
      const content = raw.length ? raw : ' ';
      const baselinePx = currentYpx + fontSizePx * 0.82;
      pdf.text(content, pxToIn(xPx), pxToIn(baselinePx), { align });
    });
  });
};

const loadImageElement = (source: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load template image for print rendering.'));
    image.src = source;
  });
};

const rasterizeTemplateToPng = async (source: string) => {
  const image = await loadImageElement(source);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to prepare print canvas for template rendering.');
  }
  // Match preview behavior: stretch template to exact card dimensions.
  ctx.drawImage(image, 0, 0, CARD_WIDTH, CARD_HEIGHT);
  return canvas.toDataURL('image/png');
};

const rasterizeSvgToPng = async (svgMarkup: string) => {
  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImageElement(svgUrl);
    const canvas = document.createElement('canvas');
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to prepare print canvas for SVG rendering.');
    }
    ctx.drawImage(image, 0, 0, CARD_WIDTH, CARD_HEIGHT);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
};

const paintPrintPageBackground = async (pdf: jsPDF, sideLayout: SideLayout) => {
  const resolvedBackgroundCmyk = normalizeCmyk(sideLayout.cmykBackgroundColor || hexToCmyk(sideLayout.backgroundColor) || { c: 0, m: 0, y: 0, k: 0 });
  pdf.setFillColor(
    (resolvedBackgroundCmyk.c / 100).toFixed(3) as unknown as number,
    (resolvedBackgroundCmyk.m / 100).toFixed(3) as unknown as number,
    (resolvedBackgroundCmyk.y / 100).toFixed(3) as unknown as number,
    (resolvedBackgroundCmyk.k / 100).toFixed(3) as unknown as number
  );
  pdf.rect(0, 0, PRINT_CARD_WIDTH_IN, PRINT_CARD_HEIGHT_IN, 'F');

  if (!sideLayout.backgroundImage) return;

  try {
    const templatePng = await rasterizeTemplateToPng(sideLayout.backgroundImage);
    pdf.addImage(templatePng, 'PNG', 0, 0, PRINT_CARD_WIDTH_IN, PRINT_CARD_HEIGHT_IN, undefined, 'FAST');
  } catch (error) {
    console.warn('Unable to rasterize template image for print PDF page.', error);
  }
};

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

const CustomizerScreen = ({ layout, onBack, onComplete, settings, productHandle, returnUrl, cartEnabled, cartReason, tagLookupEnabled, isAdmin, initialPhoneNumbers }: { layout: Layout, onBack: () => void, onComplete: (data: CardData) => void, settings: AppSettings, productHandle: string | null, returnUrl: string | null, cartEnabled: boolean, cartReason?: string | null, tagLookupEnabled: boolean, isAdmin: boolean, initialPhoneNumbers?: PhoneNumberEntry[] }) => {
  const [step, setStep] = useState<'form' | 'proof' | 'quantity'>('form');
  const [data, setData] = useState<CardData>(() => createInitialCardData(layout, initialPhoneNumbers));
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
  const [postAddCartState, setPostAddCartState] = useState<{ open: boolean; checkoutUrl: string | null }>({ open: false, checkoutUrl: null });
  const [livePdfPreview, setLivePdfPreview] = useState<{ front: string | null; back: string | null }>({ front: null, back: null });
  const livePreviewRenderToken = useRef(0);
  const proofRef = useRef<HTMLDivElement>(null);
  const baseProductHandle = useMemo(() => productHandle || layout.shopifyProductHandle || null, [productHandle, layout.shopifyProductHandle]);
  const tagLookupActive = tagLookupEnabled && Boolean(layout.shopifyTags?.length);
  const effectiveProductHandle = baseProductHandle || derivedProductHandle;
  const allFieldRefs = useMemo<SideFieldRef[]>(() => {
    const refs: SideFieldRef[] = [];
    const pushSideRefs = (side: CardSide, sideLayout?: SideLayout) => {
      if (!sideLayout) return;
      const orderedKeys = sideLayout.fieldOrder?.length ? sideLayout.fieldOrder : Object.keys(sideLayout.fields || {});
      orderedKeys.forEach((key) => {
        if (!sideLayout.fields?.[key]) return;
        refs.push({ id: `${side}:${key}`, side, key });
      });
    };

    pushSideRefs('front', layout.front);
    pushSideRefs('back', layout.back);
    return refs;
  }, [layout.front, layout.back]);
  const getFieldDefinition = useCallback((fieldRef: SideFieldRef) => {
    const sideLayout = fieldRef.side === 'back' ? layout.back : layout.front;
    return sideLayout?.fields?.[fieldRef.key] || null;
  }, [layout.back, layout.front]);
  const formFieldRefs = useMemo(() => allFieldRefs.filter((fieldRef) => getFieldDefinition(fieldRef)?.showInForm !== false), [allFieldRefs, getFieldDefinition]);
  const lockedFieldRefs = useMemo(() => allFieldRefs.filter((fieldRef) => getFieldDefinition(fieldRef)?.showInForm === false), [allFieldRefs, getFieldDefinition]);
  const hasBackSide = Boolean(layout.back);
  const previewSideLayout = previewSide === 'front' ? layout.front : layout.back || layout.front;
  const canReturnToProduct = Boolean(returnUrl);
  const configuredPhoneNumbers = data.phoneNumbers || [];

  const updatePhoneNumberEntries = useCallback((nextEntries: PhoneNumberEntry[]) => {
    setData((prev) => {
      const normalizedEntries = nextEntries.map((entry) => ({
        type: String(entry.type || '').trim() || 'Telephone',
        value: String(entry.value || '')
      }));
      const primaryPhone = normalizedEntries.find((entry) => entry.value.trim())?.value || '';
      const mobilePhone = normalizedEntries.find((entry) => ['Mobile', 'Cell'].includes(entry.type) && entry.value.trim())?.value || '';
      return {
        ...prev,
        phone: primaryPhone,
        mobile: mobilePhone,
        phoneNumbers: normalizedEntries
      };
    });
  }, []);
  const getFieldValue = useCallback((fieldRef: SideFieldRef, sourceData: CardData = data) => {
    const { side, key } = fieldRef;
    const namespacedValue = sourceData.customValues?.[toSideValueKey(side, key)];

    if (side === 'back') {
      if (namespacedValue !== undefined && namespacedValue !== null) return String(namespacedValue);
      const fallbackLegacyBackValue = sourceData.customValues?.[key];
      if (fallbackLegacyBackValue !== undefined && fallbackLegacyBackValue !== null) return String(fallbackLegacyBackValue);
      return '';
    }

    if (Object.prototype.hasOwnProperty.call(sourceData, key)) {
      const raw = (sourceData as any)[key];
      if (raw === undefined || raw === null) return '';
      return typeof raw === 'string' ? raw : String(raw);
    }

    if (namespacedValue !== undefined && namespacedValue !== null) return String(namespacedValue);
    return sourceData.customValues?.[key] || '';
  }, [data]);

  const getRenderDataForSide = useCallback((side: CardSide, sourceData: CardData = data): CardData => {
    if (side === 'front') return sourceData;

    const sideLayout = layout.back || layout.front;
    if (!sideLayout) return sourceData;

    const nextData: CardData = {
      ...sourceData,
      customValues: { ...(sourceData.customValues || {}) }
    };

    const sideKeys = sideLayout.fieldOrder?.length ? sideLayout.fieldOrder : Object.keys(sideLayout.fields || {});
    sideKeys.forEach((key) => {
      const sideValue = sourceData.customValues?.[toSideValueKey(side, key)];
      if (sideValue === undefined || sideValue === null || sideValue === '') return;

      if (SIDE_AWARE_NATIVE_KEYS.has(key)) {
        (nextData as any)[key] = String(sideValue);
      } else {
        nextData.customValues = {
          ...(nextData.customValues || {}),
          [key]: String(sideValue)
        };
      }
    });

    return nextData;
  }, [data, layout.back, layout.front]);

  const returnToProductPage = useCallback((params?: Record<string, string | null | undefined>) => {
    if (!returnUrl) return;
    try {
      const parsed = new URL(returnUrl);
      if (parsed.origin === window.location.origin) return;
      window.location.href = buildReturnUrl(returnUrl, params || {});
    } catch {
      return;
    }
  }, [returnUrl]);

  const buildLineItemProperties = useCallback((proof: { reference: string | null; proofUrl: string | null }) => {
    const properties: Record<string, string> = {};

    allFieldRefs.forEach((fieldRef) => {
      const field = getFieldDefinition(fieldRef);
      const value = (getFieldValue(fieldRef) || field?.value || '').trim();
      if (!value) return;
      const baseLabel = (field?.label || fieldRef.key).trim();
      const label = fieldRef.side === 'back' ? `Back ${baseLabel}` : baseLabel;
      if (properties[label]) return;
      properties[label] = value;
    });

    configuredPhoneNumbers.forEach((entry, index) => {
      const type = String(entry.type || '').trim();
      const value = String(entry.value || '').trim();
      if (!value) return;
      properties[`Phone ${index + 1} Type`] = type || 'Phone';
      properties[`Phone ${index + 1}`] = value;
    });

    const privateProperties: Record<string, string> = {
      _cardify_layout_id: layout.id,
      _cardify_layout_name: layout.name
    };

    if (proof.reference) {
      privateProperties._cardify_proof_reference = proof.reference;
    }

    const resolvedProofUrl = proof.proofUrl
      || (proof.reference
        ? `${DEFAULT_PROOF_BASE_URL}/proofs/${proof.reference}`
        : null);

    if (resolvedProofUrl) {
      privateProperties._cardify_proof_url = resolvedProofUrl;
    }

    if (effectiveProductHandle) {
      privateProperties._cardify_product_handle = effectiveProductHandle;
    }

    if (returnUrl) {
      privateProperties._cardify_return_url = returnUrl;
    }

    Object.entries(privateProperties).forEach(([key, value]) => {
      const normalized = String(value || '').trim();
      if (!normalized) return;
      properties[key] = normalized;
    });

    return properties;
  }, [allFieldRefs, configuredPhoneNumbers, effectiveProductHandle, getFieldDefinition, getFieldValue, layout.id, layout.name, returnUrl]);

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
    setData(createInitialCardData(layout));
  }, [layout.id]);

  const updateField = (fieldRef: SideFieldRef, value: string) => {
    const normalizedValue = fieldRef.key === 'phone' || fieldRef.key === 'mobile'
      ? sanitizePhoneDigits(value)
      : value;

    setFieldErrors((prev) => {
      if (!prev[fieldRef.id]) return prev;
      if (!normalizedValue.trim()) return prev;
      const next = { ...prev };
      delete next[fieldRef.id];
      return next;
    });
    setData((prev) => {
      const sideValueKey = toSideValueKey(fieldRef.side, fieldRef.key);

      if (fieldRef.side === 'back') {
        return {
          ...prev,
          customValues: {
            ...(prev.customValues || {}),
            [sideValueKey]: normalizedValue
          }
        };
      }

      if (fieldRef.key === 'addressLine1') {
        return { ...prev, addressLine1: normalizedValue };
      }
      if (fieldRef.key in prev) {
        return { ...prev, [fieldRef.key]: normalizedValue } as CardData;
      }
      return {
        ...prev,
        customValues: {
          ...(prev.customValues || {}),
          [fieldRef.key]: normalizedValue,
          [sideValueKey]: normalizedValue
        }
      };
    });
  };

  const handleFormAdvance = useCallback(() => {
    if (!formFieldRefs.length) {
      setFieldErrors({});
      setStep('proof');
      return;
    }
    const missing: Record<string, boolean> = {};
    formFieldRefs.forEach((fieldRef) => {
      const field = getFieldDefinition(fieldRef);
      if (!field?.required) return;
      const currentValue = getFieldValue(fieldRef).trim();
      if (!currentValue) {
        missing[fieldRef.id] = true;
      }
    });
    if (Object.keys(missing).length) {
      setFieldErrors(missing);
      return;
    }
    setFieldErrors({});
    setStep('proof');
  }, [formFieldRefs, getFieldDefinition, getFieldValue]);

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

  const renderSvgToPdfPage = async (pdf: jsPDF, svgMarkup: string) => {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(svgMarkup, 'image/svg+xml');
    const svgElement = parsed.documentElement as unknown as SVGElement;
    const svgRenderer = (pdf as unknown as {
      svg?: (element: SVGElement, options?: { x?: number; y?: number; width?: number; height?: number; preserveAspectRatio?: string }) => Promise<void>;
    }).svg;

    if (!svgRenderer) {
      throw new Error('SVG-to-PDF renderer is unavailable. Ensure svg2pdf.js is loaded.');
    }

    await svgRenderer.call(pdf, svgElement, {
      x: 0,
      y: 0,
      width: PRINT_CARD_WIDTH_IN,
      height: PRINT_CARD_HEIGHT_IN,
      preserveAspectRatio: 'none'
    });
  };

  const createPrintReadyPdf = async (): Promise<Uint8Array> => {
    const sides: Array<{ sideName: CardSide; sideLayout: SideLayout }> = [
      { sideName: 'front', sideLayout: layout.front },
      ...(layout.back ? [{ sideName: 'back' as const, sideLayout: layout.back }] : [])
    ];
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(`${layout.name} Print Ready`);
    pdfDoc.setSubject('Print-ready PDF generated with PDF templates and embedded fonts');
    pdfDoc.setCreator('Theme Vault Designer');
    const embeddedFonts = await registerEmbeddedPrintFonts(pdfDoc, layout.fontAssets || []);

    for (let index = 0; index < sides.length; index += 1) {
      const templatePdfDataUrl = getSideTemplatePdfDataUrl(sides[index].sideLayout);
      if (!templatePdfDataUrl) {
        throw new Error(`Missing ${sides[index].sideName} print template PDF. Upload a PDF template before approving.`);
      }

      const templateBytes = dataUrlToBytes(templatePdfDataUrl);
      const [embeddedTemplatePage] = await pdfDoc.embedPdf(templateBytes, [0]);
      const page = pdfDoc.addPage([PRINT_PAGE_WIDTH_PT, PRINT_PAGE_HEIGHT_PT]);
      // Explicitly mark PDF boxes: media/bleed at full page, trim at finished 3.5x2in.
      page.setMediaBox(0, 0, PRINT_PAGE_WIDTH_PT, PRINT_PAGE_HEIGHT_PT);
      page.setBleedBox(0, 0, PRINT_PAGE_WIDTH_PT, PRINT_PAGE_HEIGHT_PT);
      page.setTrimBox(PRINT_BLEED_PT, PRINT_BLEED_PT, PRINT_CARD_WIDTH_PT, PRINT_CARD_HEIGHT_PT);
      page.setCropBox(PRINT_BLEED_PT, PRINT_BLEED_PT, PRINT_CARD_WIDTH_PT, PRINT_CARD_HEIGHT_PT);
      page.drawPage(embeddedTemplatePage, {
        x: 0,
        y: 0,
        width: PRINT_PAGE_WIDTH_PT,
        height: PRINT_PAGE_HEIGHT_PT
      });

      const sideData = getRenderDataForSide(sides[index].sideName, data);
      const svg = buildCardSvg({
        side: {
          ...sides[index].sideLayout,
          // Text is drawn natively in PDF; avoid re-rendering template images in SVG.
          backgroundImage: undefined
        },
        data: sideData,
        settings,
        fontAssets: layout.fontAssets || [],
        preserveTextNodes: true
      });
      const textRuns = extractSvgTextRuns(svg);
      await drawSvgTextRunsOnPdfPage(pdfDoc, page, textRuns, embeddedFonts, PRINT_PAGE_WIDTH_PT, PRINT_PAGE_HEIGHT_PT, {
        x: PRINT_BLEED_PT,
        y: PRINT_BLEED_PT,
        width: PRINT_CARD_WIDTH_PT,
        height: PRINT_CARD_HEIGHT_PT
      });
    }

    return pdfDoc.save();
  };

  useEffect(() => {
    const hasPdfTemplate = Boolean(layout.front.backgroundPdf || layout.back?.backgroundPdf);
    if (!hasPdfTemplate) {
      setLivePdfPreview({ front: null, back: null });
      return;
    }

    let cancelled = false;
    const requestToken = livePreviewRenderToken.current + 1;
    livePreviewRenderToken.current = requestToken;

    const timeoutId = window.setTimeout(async () => {
      try {
        const printReadyBytes = await createPrintReadyPdf();
        const rendered = await renderPdfBytesToPreviewImages(printReadyBytes);
        if (cancelled || requestToken !== livePreviewRenderToken.current) return;
        setLivePdfPreview(rendered);
      } catch (error) {
        if (cancelled || requestToken !== livePreviewRenderToken.current) return;
        console.warn('Unable to render CMYK-matched live preview from print-ready PDF.', error);
        setLivePdfPreview({ front: null, back: null });
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    data,
    layout.back,
    layout.fontAssets,
    layout.front,
    settings
  ]);

  const downloadCanvasImage = (canvas: HTMLCanvasElement, fileName: string, quality = 0.82) => {
    const anchor = document.createElement('a');
    anchor.href = canvas.toDataURL('image/jpeg', quality);
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const exportBaseName = layout.name.replace(/\s+/g, '-');

  const handleDownloadProofJpg = async () => {
    setProofStatus('generating');
    try {
      const canvas = await capturePreview({ watermark: true, scale: 1.1 });
      downloadCanvasImage(canvas, `${exportBaseName}-PRINT_READY.jpg`, 0.8);
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
      pdf.save(`${exportBaseName}-PRINT_READY.pdf`);
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
        { suffix: 'front', sideName: 'front' as const, side: layout.front },
        ...(layout.back ? [{ suffix: 'back', sideName: 'back' as const, side: layout.back }] : [])
      ];
      exports.forEach(({ suffix, sideName, side }) => {
        const sideData = getRenderDataForSide(sideName, data);
        const svg = buildCardSvg({ side, data: sideData, settings, fontAssets: layout.fontAssets || [] });
        downloadTextFile(`${exportBaseName}-${suffix}.svg`, svg, 'image/svg+xml;charset=utf-8');
      });
    } catch (error) {
      console.error('Unable to export vector artwork', error);
      alert('Unable to generate the SVG artwork. Please try again.');
    } finally {
      setProofStatus('idle');
    }
  };

  const uploadPrintReadyPdf = async (): Promise<{ reference: string | null; proofUrl: string | null }> => {
    try {
      const pdfBytes = await createPrintReadyPdf();
      const base64 = bytesToBase64(pdfBytes);
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
      return {
        reference: payload.reference ?? null,
        proofUrl: payload.proofUrl ?? null
      };
    } catch (error) {
      console.warn('Print-ready PDF upload skipped', error);
      return { reference: null, proofUrl: null };
    }
  };

  const handleFinalizeRequest = async () => {
    if ((cartEnabled || returnUrl) && !selectedVariant) {
      alert('Select a quantity option before continuing.');
      return;
    }
    setCheckoutStatus('loading');
    try {
      const proof = await uploadPrintReadyPdf();
      if (cartEnabled) {
        const payload = {
          cartId: isBrowser ? safeLocalStorage?.getItem(SHOPIFY_CART_ID_STORAGE_KEY) || undefined : undefined,
          items: [
            {
              id: selectedVariant?.id,
              quantity: 1,
              properties: buildLineItemProperties(proof)
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
          const detail = errorPayload?.detail
            ? ` ${typeof errorPayload.detail === 'string' ? errorPayload.detail : JSON.stringify(errorPayload.detail)}`
            : '';
          throw new Error(`${errorPayload?.message || 'Cart endpoint unavailable'}${detail}`);
        }
        const result = await response.json();
        if (result?.cartId && isBrowser) {
          safeLocalStorage?.setItem(SHOPIFY_CART_ID_STORAGE_KEY, String(result.cartId));
        }
        onComplete(data);
        const redirectUrl = result?.checkoutUrl || result?.redirectUrl;
        if (redirectUrl) {
          try {
            const checkoutUrl = new URL(redirectUrl);
            if (returnUrl) {
              checkoutUrl.searchParams.set('return_to', returnUrl);
            }
            setPostAddCartState({ open: true, checkoutUrl: checkoutUrl.toString() });
          } catch {
            setPostAddCartState({ open: true, checkoutUrl: redirectUrl });
          }
        } else {
          setPostAddCartState({ open: true, checkoutUrl: null });
        }
      } else if (returnUrl && selectedVariant) {
        onComplete(data);
        const redirectUrl = buildShopifyCartAddUrl({
          returnUrl,
          variantId: selectedVariant.id,
          quantity: 1,
          properties: buildLineItemProperties(proof)
        });
        window.location.href = redirectUrl;
        return;
      } else {
        onComplete(data);
        if (returnUrl) {
          returnToProductPage({
            cardify_status: 'approved',
            cardify_layout: layout.id,
            cardify_proof: proof.reference || 'manual_review',
            cardify_variant: String(selectedVariant?.id || '')
          });
          return;
        }
        const contactEmail = settings.businessEmail || 'your print rep';
        const selectionBlurb = selectedVariant ? ` referencing ${selectedVariant.title}` : '';
        alert(`Proof approved! Share reference ${proof.reference || 'manual_review'}${selectionBlurb} with ${contactEmail} to place your order.`);
      }
    } catch (error) {
      console.error(error);
      setCheckoutStatus('error');
      alert((error as Error).message || 'We were unable to finalize this request automatically.');
    } finally {
      setCheckoutStatus('idle');
    }
  };

  const renderPreviewCard = (sideName: CardSide, sideLayout: SideLayout, scale: number) => {
    const previewImage = sideName === 'front' ? livePdfPreview.front : livePdfPreview.back;
    if (previewImage) {
      const scaledWidth = CARD_WIDTH * scale;
      const scaledHeight = CARD_HEIGHT * scale;
      return (
        <div
          className="flex-shrink-0"
          style={{
            width: `${scaledWidth}px`,
            height: `${scaledHeight}px`,
            position: 'relative',
            border: '1px solid #cbd5e1',
            borderRadius: '2px',
            overflow: 'hidden',
            boxShadow: '0 15px 30px -10px rgba(0, 0, 0, 0.15)'
          }}
        >
          <img
            src={previewImage}
            alt={`${sideName} preview`}
            className="absolute inset-0 h-full w-full"
          />
        </div>
      );
    }

    return (
      <BusinessCardPreview
        data={getRenderDataForSide(sideName, data)}
        scale={scale}
        side={sideLayout}
        settings={settings}
        fontAssets={layout.fontAssets}
      />
    );
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
          {formFieldRefs.length ? (
            <div className="space-y-3">
              {formFieldRefs.map((fieldRef) => {
                const field = getFieldDefinition(fieldRef);
                if (!field) return null;
                const value = getFieldValue(fieldRef);
                const isRequired = Boolean(field.required);
                const showError = Boolean(fieldErrors[fieldRef.id]);
                return (
                  <label key={fieldRef.id} className="space-y-1.5 text-[11px] font-semibold text-slate-600">
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        {field.label || fieldRef.key}
                        {isRequired && <span className="text-red-500 ml-2">*</span>}
                      </span>
                      {showError && <span className="text-[10px] text-red-500 font-bold">Required</span>}
                    </div>
                    {ADDRESS_FIELD_KEYS.has(fieldRef.key) ? (
                      <AddressAutocomplete
                        value={value}
                        onChange={(val) => updateField(fieldRef, val)}
                        onFocus={() => setPreviewSide(fieldRef.side)}
                        placeholder={field.placeholder || `Enter ${field.label || fieldRef.key}`}
                        hasError={showError}
                        ariaRequired={isRequired || undefined}
                        ariaInvalid={showError || undefined}
                      />
                    ) : (
                      <input
                        value={value}
                        onChange={(e) => updateField(fieldRef, e.target.value)}
                        onFocus={() => setPreviewSide(fieldRef.side)}
                        placeholder={field.placeholder || `Enter ${field.label || fieldRef.key}`}
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
          {lockedFieldRefs.length > 0 && (
            <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 space-y-2">
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-500">Preset details</p>
              <ul className="space-y-1 text-[11px] text-slate-600">
                {lockedFieldRefs.map((fieldRef) => (
                  <li key={fieldRef.id} className="flex justify-between gap-3">
                    <span className="font-semibold text-slate-500">{getFieldDefinition(fieldRef)?.label || fieldRef.key}</span>
                    <span className="text-slate-800">{getFieldValue(fieldRef) || getFieldDefinition(fieldRef)?.value || '—'}</span>
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
      <div className="hidden lg:block bg-white border border-slate-200 rounded-[22px] p-5 relative lg:sticky lg:top-8 space-y-4">
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
          {renderPreviewCard(previewSide, previewSideLayout, convertLegacyDisplayScale(1.35))}
        </div>
      </div>
    </div>
  );

  const mobileLivePreview = step === 'form' ? (
    <div className="lg:hidden fixed inset-x-3 bottom-3 z-40 rounded-[20px] border border-slate-200 bg-white/95 p-3 shadow-[0_18px_45px_-20px_rgba(15,23,42,0.45)] backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.35em] text-slate-400">Live Preview</div>
        {hasBackSide && (
          <div className="flex gap-1.5 text-[10px] font-black uppercase tracking-[0.22em]">
            {(['front', 'back'] as const).map((side) => (
              <button
                key={`mobile-${side}`}
                onClick={() => setPreviewSide(side)}
                className={`px-2.5 py-1.5 rounded-lg border ${previewSide === side ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
              >
                {side}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 overflow-hidden">
        {renderPreviewCard(previewSide, previewSideLayout, convertLegacyDisplayScale(0.78))}
      </div>
    </div>
  ) : null;

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
              {renderPreviewCard('front', layout.front, hasBackSide ? convertLegacyDisplayScale(1.05) : convertLegacyDisplayScale(1.6))}
            </div>
            {hasBackSide && layout.back && (
              <div className="shrink-0">
                {renderPreviewCard('back', layout.back, convertLegacyDisplayScale(1.05))}
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
                  <Download size={14} /> {proofStatus === 'generating' ? 'Preparing...' : 'Download Print Ready PDF'}
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
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 leading-relaxed">
            Please review all spelling, names, titles, contact information, alignment, and brand details carefully before approval. Approval confirms the artwork is final and production-ready. Once approved, the order may proceed immediately and we cannot accept liability for typographical errors, omitted information, or customer-approved content issues.
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

  const postAddModal = cartEnabled && step === 'quantity' && postAddCartState.open ? (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[30px] border border-slate-100 bg-white p-6 shadow-2xl space-y-5">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.35em] text-emerald-600">Added To Cart</p>
          <h3 className="mt-2 text-3xl font-black text-slate-900 uppercase tracking-tight">Add Another Name?</h3>
          <p className="mt-2 text-sm text-slate-500">You can keep adding names to the same cart, then check out once with one combined order.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <button
            onClick={() => {
              setPostAddCartState({ open: false, checkoutUrl: null });
              onBack();
            }}
            className="rounded-2xl border border-slate-200 px-5 py-3 text-[11px] font-black uppercase tracking-[0.3em] text-slate-600"
          >
            Add Another Name
          </button>
          <button
            onClick={() => {
              const checkoutUrl = postAddCartState.checkoutUrl;
              setPostAddCartState({ open: false, checkoutUrl: null });
              if (checkoutUrl) {
                window.location.href = checkoutUrl;
                return;
              }
              if (returnUrl) {
                returnToProductPage({
                  cardify_status: 'cart_created',
                  cardify_layout: layout.id,
                  cardify_variant: String(selectedVariant?.id || '')
                });
                return;
              }
              alert('Cart was updated but no checkout URL was returned.');
            }}
            className="rounded-2xl bg-slate-900 px-5 py-3 text-[11px] font-black uppercase tracking-[0.3em] text-white"
          >
            Checkout Now
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className={`max-w-5xl mx-auto p-6 space-y-8 animate-fadeIn ${step === 'form' ? 'pb-48 lg:pb-6' : ''}`}>
      {step === 'form' && formStep}
      {step === 'proof' && proofStep}
      {step === 'quantity' && quantityStep}
      {mobileLivePreview}
      {postAddModal}

      {showApprovalModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[22px] p-6 max-w-lg w-full space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                <CheckCircle size={20} />
              </div>
              <div>
                <p className="text-lg font-black text-slate-900">Approve Proof</p>
                <p className="text-sm text-slate-500">Final confirmation: are you sure this proof is ready for production?</p>
              </div>
            </div>
            <div className="bg-slate-100 rounded-2xl p-3">
              {renderPreviewCard('front', layout.front, convertLegacyDisplayScale(1))}
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Please double-check every visible detail before continuing, including spelling, phone numbers, email addresses, titles, positioning, and brand presentation. By selecting Looks Good, you confirm the proof is accurate, approved for print, and authorized for production release. After approval, changes may not be possible and we are not liable for customer-approved errors, omissions, or late correction requests.
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
          <BusinessCardPreview data={getRenderDataForSide('front', data)} scale={convertLegacyDisplayScale(1.6)} side={layout.front} settings={settings} fontAssets={layout.fontAssets} />
          {layout.back && (
            <BusinessCardPreview data={getRenderDataForSide('back', data)} scale={convertLegacyDisplayScale(1.6)} side={layout.back} settings={settings} fontAssets={layout.fontAssets} />
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
  const [layoutSaveStatus, setLayoutSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminSessionReady, setAdminSessionReady] = useState(false);
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
  const [phoneSetupOpen, setPhoneSetupOpen] = useState(false);
  const [phoneSetupLayout, setPhoneSetupLayout] = useState<Layout | null>(null);
  const [phoneSetupCount, setPhoneSetupCount] = useState(1);
  const [phoneSetupEntries, setPhoneSetupEntries] = useState<PhoneNumberEntry[]>([]);
  const [phoneSetupByLayoutId, setPhoneSetupByLayoutId] = useState<Record<string, PhoneNumberEntry[]>>({});
  const shopifyQueryTags = useMemo(() => getShopifyQueryTags(), []);
  const productHandle = useMemo(() => getProductHandleFromQuery(), []);
  const returnUrl = useMemo(() => getReturnUrlFromQuery(), []);
  const selectedLayout = useMemo(() => findLayoutById(brandConfigs, activeLayoutId), [brandConfigs, activeLayoutId]);
  const maxPhoneSetupCount = useMemo(() => {
    const counts = Object.values(brandConfigs).flatMap((config) => config.layouts.map((layout) => layout.phoneNumberConfig?.maxPhones || 0));
    return Math.max(1, ...counts, 1);
  }, [brandConfigs]);
  const navigate = useNavigate();
  const handleBrandConfigsChange = useCallback((next: Record<string, BrandConfig>) => {
    setBrandConfigs(normalizeBrandConfigs(next));
  }, []);

  const handleLayoutSelection = useCallback((layout: Layout) => {
    const existingSetup = phoneSetupByLayoutId[layout.id] || [];
    const initialCount = Math.min(Math.max(existingSetup.length || 1, 1), maxPhoneSetupCount);
    const allowedTypes = layout.phoneNumberConfig?.allowedTypes || [];
    const nextEntries = existingSetup.length
      ? existingSetup.slice(0, initialCount)
      : buildPhoneSetupEntries(allowedTypes, initialCount);

    while (nextEntries.length < initialCount) {
      nextEntries.push({ type: allowedTypes[0]?.value || 'Telephone', value: '' });
    }

    setPhoneSetupLayout(layout);
    setPhoneSetupCount(initialCount);
    setPhoneSetupEntries(nextEntries);
    setPhoneSetupOpen(true);
  }, [maxPhoneSetupCount, phoneSetupByLayoutId]);

  const handlePhoneSetupConfirm = useCallback(() => {
    if (!phoneSetupLayout) return;
    const resolvedLayout = resolvePhoneSetupLayout(phoneSetupLayout, phoneSetupEntries, phoneSetupCount, brandConfigs);
    const allowedTypes = resolvedLayout.phoneNumberConfig?.allowedTypes || phoneSetupLayout.phoneNumberConfig?.allowedTypes || [];
    const normalizedEntries = Array.from({ length: phoneSetupCount }, (_, index) => {
      const entry = phoneSetupEntries[index] || { type: allowedTypes[0]?.value || 'Telephone', value: '' };
      return {
        type: entry.type || allowedTypes[0]?.value || 'Telephone',
        value: entry.value || ''
      };
    });

    setPhoneSetupByLayoutId((prev) => ({
      ...prev,
      [resolvedLayout.id]: normalizedEntries
    }));
    setActiveLayoutId(resolvedLayout.id);
    setFlowStep(2);
    setPhoneSetupOpen(false);
    setPhoneSetupLayout(null);
  }, [brandConfigs, phoneSetupCount, phoneSetupEntries, phoneSetupLayout]);

  const phoneSetupResolveMessage = useMemo(() => {
    if (!phoneSetupLayout) return '';
    const resolved = resolvePhoneSetupLayout(phoneSetupLayout, phoneSetupEntries, phoneSetupCount, brandConfigs);
    if (resolved.id === phoneSetupLayout.id) {
      return `This setup fits ${phoneSetupLayout.name}.`;
    }
    return `This setup will switch you to ${resolved.name}.`;
  }, [brandConfigs, phoneSetupCount, phoneSetupEntries, phoneSetupLayout]);

  const loadingScreen = (
    <div className="max-w-4xl mx-auto px-6 py-20 text-center animate-fadeIn">
      <p className="text-[11px] font-black uppercase tracking-[0.35em] text-slate-400">Loading</p>
      <h2 className="mt-4 text-3xl font-black uppercase tracking-tight text-slate-900">Loading saved layouts</h2>
      <p className="mt-3 text-sm text-slate-500">Pulling your persisted card templates into the workspace.</p>
    </div>
  );

  useEffect(() => {
    let cancelled = false;

    const loadAdminSession = async () => {
      try {
        const response = await fetch('/api/admin/session', { credentials: 'include' });
        if (!response.ok) {
          if (!cancelled) {
            setIsAdmin(false);
            setAdminSessionReady(true);
          }
          return;
        }
        const payload = await response.json();
        if (cancelled) return;
        setIsAdmin(Boolean(payload?.isAdmin));
      } catch (error) {
        console.warn('Unable to load admin session state.', error);
        if (!cancelled) {
          setIsAdmin(false);
        }
      } finally {
        if (!cancelled) {
          setAdminSessionReady(true);
        }
      }
    };

    loadAdminSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!layoutsHydrated || !isAdmin) return;
    let cancelled = false;
    const saveTimer = window.setTimeout(() => {
      setLayoutSaveStatus('saving');
      persistLayouts(brandConfigs)
        .then(() => {
          if (!cancelled) setLayoutSaveStatus('saved');
        })
        .catch((error) => {
          console.warn('Unable to persist layouts.', error);
          if (!cancelled) setLayoutSaveStatus('error');
        });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(saveTimer);
    };
  }, [brandConfigs, isAdmin, layoutsHydrated]);

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

        setBrandConfigs({});
        setLayoutsHydrated(true);
      } catch (error) {
        console.warn('Unable to hydrate persisted layouts.', error);
        if (!cancelled) {
          setBrandConfigs({});
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
    let cancelled = false;

    const loadServerSettings = async () => {
      try {
        const response = await fetch('/api/settings', { credentials: 'include' });
        if (!response.ok) return;
        const payload = await response.json();
        if (cancelled) return;
        const serverSettings = payload?.settings;
        if (!serverSettings || typeof serverSettings !== 'object') return;
        setSettings((prev) => ({ ...prev, ...serverSettings }));
      } catch (error) {
        console.warn('Unable to load app settings from server.', error);
      }
    };

    loadServerSettings();

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
        navigate('/shopify-admin');
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [navigate]);

  const handleSettingsPersist = useCallback((next: AppSettings) => {
    setSettings(next);
    if (safeLocalStorage) {
      try {
        safeLocalStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch (error) {
        console.warn('Unable to persist settings.', error);
      }
    }
    fetch('/api/settings', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: next })
    }).catch((error) => {
      console.warn('Unable to persist settings to server.', error);
    });
  }, []);

  const handleLogin = async (pass: string) => {
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass })
      });
      if (!response.ok) {
        setIsAdmin(false);
        return false;
      }
      setIsAdmin(true);
      return true;
    } catch (error) {
      console.warn('Unable to create admin session.', error);
      setIsAdmin(false);
      return false;
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/admin/session', {
        method: 'DELETE',
        credentials: 'include'
      });
    } catch (error) {
      console.warn('Unable to clear admin session.', error);
    } finally {
      setIsAdmin(false);
      navigate('/');
    }
  };

  const adminConsole = (
    <AdminGuard isAdmin={isAdmin} authReady={adminSessionReady} onLogin={handleLogin} settings={settings}>
      {!layoutsHydrated ? loadingScreen : <div className="max-w-[1500px] mx-auto px-6 py-6 space-y-6 animate-fadeIn">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-4xl md:text-5xl font-black uppercase tracking-tighter">Vault Control</h1>
            <p className="text-slate-500 font-bold text-sm md:text-base mt-2">Layouts, palettes, proofs, and production metadata in one compact workspace.</p>
          </div>
          <div className="flex flex-wrap gap-4 text-[11px] font-black uppercase tracking-[0.32em] text-slate-400">
            {layoutSaveStatus === 'saving' && <span className="text-amber-600">Saving layouts…</span>}
            {layoutSaveStatus === 'saved' && <span className="text-emerald-600">Layouts saved</span>}
            {layoutSaveStatus === 'error' && <span className="text-red-600">Layout save failed</span>}
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
  );

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
              <Link to="/shopify-admin" className="text-[11px] font-black uppercase tracking-[0.28em] flex items-center gap-2.5 hover:text-blue-600 transition-colors"><Settings size={16}/> Management</Link>
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
                initialPhoneNumbers={phoneSetupByLayoutId[selectedLayout.id] || []}
              />
            ) : (
              <SelectionScreen onNext={handleLayoutSelection} settings={settings} brandConfigs={brandConfigs} activeTags={shopifyQueryTags} />
            )
          } />
          <Route path="/admin/*" element={adminConsole} />
          <Route path="/shopify-admin" element={adminConsole} />
        </Routes>
      </main>

      {phoneSetupOpen && phoneSetupLayout && (
        <PhoneNumberSetupModal
          layout={phoneSetupLayout}
          count={phoneSetupCount}
          entries={phoneSetupEntries}
          maxCount={maxPhoneSetupCount}
          onCountChange={(count) => {
            const nextCount = Math.min(Math.max(1, count), maxPhoneSetupCount);
            const allowedTypes = phoneSetupLayout.phoneNumberConfig?.allowedTypes || [];
            const nextEntries = Array.from({ length: nextCount }, (_, index) => phoneSetupEntries[index] || { type: allowedTypes[0]?.value || 'Telephone', value: '' });
            while (nextEntries.length < nextCount) {
              nextEntries.push({ type: allowedTypes[0]?.value || 'Telephone', value: '' });
            }
            setPhoneSetupCount(nextCount);
            setPhoneSetupEntries(nextEntries);
          }}
          onEntryChange={(index, nextEntry) => {
            setPhoneSetupEntries((prev) => {
              const next = [...prev];
              next[index] = nextEntry;
              return next;
            });
          }}
          onCancel={() => {
            setPhoneSetupOpen(false);
            setPhoneSetupLayout(null);
          }}
          onConfirm={handlePhoneSetupConfirm}
          resolveMessage={phoneSetupResolveMessage || 'Choose the setup that matches the card you want to build.'}
        />
      )}
      
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
  <BrowserRouter>
    <MainLayout />
  </BrowserRouter>
);

export default App;
