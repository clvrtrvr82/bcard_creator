import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppSettings, BrandConfig, Layout } from '../types';
import LayoutEditor from './LayoutEditor';
import LayoutAssetsEditor from './LayoutAssetsEditor';
import { Search, Plus, Save, Trash2, Copy, Download, Upload } from 'lucide-react';
import { CARD_CANVAS_VERSION } from '../cardCanvas';

interface AdminDashboardProps {
  brandConfigs: Record<string, BrandConfig>;
  onBrandConfigsChange: (configs: Record<string, BrandConfig>) => void;
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

interface LayoutTransferPayload {
  version: 1;
  exportedAt: string;
  brandConfigs: Record<string, BrandConfig>;
  settings?: AppSettings;
}

const createBlankBrandConfig = (brand: string): BrandConfig => ({
  primaryColor: '#0f172a',
  secondaryColor: '#ffffff',
  accentColor: '#0284c7',
  logo: '',
  layouts: []
});

const createLayoutTemplate = (brand: string): Layout => ({
  id: `layout-${Date.now()}`,
  brand,
  canvasVersion: CARD_CANVAS_VERSION,
  name: 'Untitled Layout',
  previewUrl: '',
  shopifyProductHandle: '',
  front: {
    backgroundColor: '#ffffff',
    fields: {},
    fieldOrder: []
  },
  back: undefined
});

const cloneConfigs = (configs: Record<string, BrandConfig>): Record<string, BrandConfig> => JSON.parse(JSON.stringify(configs));
const cloneLayout = (layout: Layout): Layout => JSON.parse(JSON.stringify(layout));
const ensureBrandBucket = (clone: Record<string, BrandConfig>, brand: string) => {
  if (!clone[brand]) {
    clone[brand] = createBlankBrandConfig(brand);
  }
};
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isBrandConfigsPayload = (value: unknown): value is Record<string, BrandConfig> => {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => isRecord(entry) && Array.isArray(entry.layouts));
};
const mergeSettings = (current: AppSettings, incoming?: Partial<AppSettings>): AppSettings => ({
  ...current,
  ...(incoming || {})
});

const AdminDashboard: React.FC<AdminDashboardProps> = ({ brandConfigs, onBrandConfigsChange, settings, onSettingsChange }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'layouts' | 'assets' | 'settings'>('overview');
  const [search, setSearch] = useState('');
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
  const [workingLayout, setWorkingLayout] = useState<Layout | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState(settings);
  const importFileRef = useRef<HTMLInputElement>(null);

  const allLayouts = useMemo(() => Object.entries(brandConfigs).flatMap(([brandKey, config]) => config.layouts.map((layout) => ({ ...layout, brand: layout.brand ?? brandKey }))), [brandConfigs]);

  useEffect(() => {
    if (!selectedLayoutId && allLayouts.length) {
      setSelectedLayoutId(allLayouts[0].id);
    }
  }, [allLayouts, selectedLayoutId]);

  useEffect(() => {
    if (!selectedLayoutId) {
      setWorkingLayout(null);
      return;
    }
    const target = allLayouts.find((layout) => layout.id === selectedLayoutId);
    if (target) {
      setWorkingLayout(cloneLayout(target));
    } else {
      setWorkingLayout(null);
    }
  }, [selectedLayoutId, allLayouts]);

  useEffect(() => {
    setSettingsForm(settings);
  }, [settings]);

  const filteredLayouts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return allLayouts;
    return allLayouts.filter((layout) => layout.name.toLowerCase().includes(query));
  }, [allLayouts, search]);

  const getDefaultBrandKey = () => workingLayout?.brand?.toString() || allLayouts[0]?.brand?.toString() || Object.keys(brandConfigs)[0] || 'Universal';

  const pushMessage = (text: string) => {
    setMessage(text);
    setError(null);
  };

  const pushError = (text: string) => {
    setError(text);
    setMessage(null);
  };

  const handleSelectLayout = (layoutId: string) => {
    setSelectedLayoutId(layoutId);
  };

  const handleOpenAssets = () => {
    setActiveTab('assets');
  };

  const handleWorkingLayoutChange = (nextLayout: Layout) => {
    setWorkingLayout(nextLayout);
    const brand = nextLayout.brand?.toString() || getDefaultBrandKey();
    const configsClone = cloneConfigs(brandConfigs);

    Object.keys(configsClone).forEach((brandKey) => {
      configsClone[brandKey].layouts = configsClone[brandKey].layouts.filter((layout) => layout.id !== nextLayout.id);
    });

    ensureBrandBucket(configsClone, brand);
    configsClone[brand].layouts = [...configsClone[brand].layouts, cloneLayout(nextLayout)];
    onBrandConfigsChange(configsClone);
  };

  const handleAddLayout = () => {
    const brand = getDefaultBrandKey();
    const template = createLayoutTemplate(brand);
    const clone = cloneConfigs(brandConfigs);
    ensureBrandBucket(clone, brand);
    clone[brand].layouts = [...clone[brand].layouts, template];
    onBrandConfigsChange(clone);
    setSelectedLayoutId(template.id);
    setWorkingLayout(cloneLayout(template));
    pushMessage('Layout scaffold generated.');
  };

  const handleSaveLayout = () => {
    if (!workingLayout) {
      pushError('Select a layout to save changes.');
      return;
    }
    const trimmedName = workingLayout.name.trim();
    if (!trimmedName) {
      pushError('Add a layout title before saving.');
      return;
    }
    const brand = workingLayout.brand?.toString() || getDefaultBrandKey();
    const clone = cloneConfigs(brandConfigs);
    Object.keys(clone).forEach((brandKey) => {
      clone[brandKey].layouts = clone[brandKey].layouts.filter((layout) => layout.id !== workingLayout.id);
    });
    ensureBrandBucket(clone, brand);
    clone[brand].layouts = [...clone[brand].layouts, cloneLayout({ ...workingLayout, name: trimmedName })];
    onBrandConfigsChange(clone);
    setSelectedLayoutId(workingLayout.id);
    setWorkingLayout((current) => (current ? { ...current, name: trimmedName } : current));
    pushMessage('Layout saved.');
  };

  const handleDuplicateLayout = () => {
    if (!workingLayout) return;
    const clone = cloneLayout(workingLayout);
    clone.id = `${clone.id}-copy-${Date.now()}`;
    clone.name = `${clone.name} Copy`;
    const brand = clone.brand?.toString() || getDefaultBrandKey();
    if (!brand) return;
    const configsClone = cloneConfigs(brandConfigs);
    ensureBrandBucket(configsClone, brand);
    configsClone[brand].layouts = [...configsClone[brand].layouts, clone];
    onBrandConfigsChange(configsClone);
    setSelectedLayoutId(clone.id);
    setWorkingLayout(clone);
    pushMessage('Layout duplicated.');
  };

  const handleDeleteLayout = () => {
    if (!workingLayout) return;
    const configsClone = cloneConfigs(brandConfigs);
    let removed = false;
    Object.keys(configsClone).forEach((brand) => {
      const before = configsClone[brand].layouts.length;
      configsClone[brand].layouts = configsClone[brand].layouts.filter((layout) => layout.id !== workingLayout.id);
      if (before !== configsClone[brand].layouts.length) removed = true;
    });
    if (!removed) {
      pushError('Unable to find layout to delete.');
      return;
    }
    onBrandConfigsChange(configsClone);
    const nextLayouts = Object.values(configsClone).flatMap((config) => config.layouts);
    setSelectedLayoutId(nextLayouts[0]?.id || null);
    setWorkingLayout(nextLayouts[0] ? cloneLayout(nextLayouts[0]) : null);
    pushMessage('Layout removed.');
  };

  const handleSettingsSave = () => {
    onSettingsChange(settingsForm);
    pushMessage('Studio settings updated.');
  };

  const handleExportData = () => {
    const payload: LayoutTransferPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      brandConfigs: cloneConfigs(brandConfigs),
      settings
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `theme-vault-layouts-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    pushMessage('Layout export downloaded. Import it into the Render-hosted admin to migrate your saved assets.');
  };

  const handleImportClick = () => {
    importFileRef.current?.click();
  };

  const handleImportData = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result || '{}')) as LayoutTransferPayload | Record<string, BrandConfig>;
        const nextConfigs = isBrandConfigsPayload(raw)
          ? raw
          : isRecord(raw) && isBrandConfigsPayload(raw.brandConfigs)
            ? raw.brandConfigs
            : null;

        if (!nextConfigs) {
          pushError('Import failed. Choose a JSON file exported from the layout migration tool.');
          return;
        }

        onBrandConfigsChange(cloneConfigs(nextConfigs));

        if (isRecord(raw) && isRecord(raw.settings)) {
          const nextSettings = mergeSettings(settings, raw.settings as Partial<AppSettings>);
          onSettingsChange(nextSettings);
          setSettingsForm(nextSettings);
        }

        const firstImportedLayout = Object.values(nextConfigs).flatMap((config) => config.layouts)[0];
        setSelectedLayoutId(firstImportedLayout?.id || null);
        setActiveTab('layouts');
        pushMessage('Layout library imported. Render now has the same browser-saved layouts and assets from your export file.');
      } catch (importError) {
        console.error('Unable to import layout payload.', importError);
        pushError('Import failed. The selected file is not valid JSON.');
      } finally {
        if (importFileRef.current) {
          importFileRef.current.value = '';
        }
      }
    };
    reader.readAsText(file);
  };

  const totalLayouts = allLayouts.length;
  const taggedLayouts = allLayouts.filter((layout) => (layout.shopifyTags?.length || 0) > 0).length;
  const untaggedLayouts = Math.max(totalLayouts - taggedLayouts, 0);
  const totalCustomFonts = allLayouts.reduce((acc, layout) => acc + (layout.customFonts?.length || 0), 0);
  const renderOverview = () => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="p-6 rounded-[28px] bg-white border border-slate-100 shadow-xl">
        <p className="text-slate-400 text-[11px] font-black uppercase tracking-[0.35em]">Available Layouts</p>
        <p className="text-4xl font-black text-slate-900 mt-3">{totalLayouts}</p>
        <p className="text-xs text-slate-400 mt-1">{taggedLayouts} tagged for Shopify</p>
      </div>
      <div className="p-6 rounded-[28px] bg-white border border-slate-100 shadow-xl">
        <p className="text-slate-400 text-[11px] font-black uppercase tracking-[0.35em]">Needs Attention</p>
        <p className="text-4xl font-black text-amber-600 mt-3">{untaggedLayouts}</p>
        <p className="text-xs text-slate-400 mt-1">Layouts missing trigger tags</p>
      </div>
      <div className="p-6 rounded-[28px] bg-white border border-slate-100 shadow-xl">
        <p className="text-slate-400 text-[11px] font-black uppercase tracking-[0.35em]">Saved Assets</p>
        <p className="text-4xl font-black text-slate-900 mt-3">{totalCustomFonts}</p>
        <p className="text-xs text-slate-400 mt-1">Global custom font entries</p>
      </div>
    </div>
  );

  const renderLayoutList = () => (
    <div className="bg-white border border-slate-100 rounded-[20px] p-3 space-y-2.5 max-h-[360px] overflow-y-auto">
      {filteredLayouts.length === 0 && <p className="text-center text-slate-400 text-sm">No layouts match that search.</p>}
      {filteredLayouts.map((layout) => (
        <button
          key={layout.id}
          onClick={() => handleSelectLayout(layout.id)}
          className={`w-full text-left p-3 rounded-2xl border transition-all ${selectedLayoutId === layout.id ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-transparent bg-slate-50 text-slate-600'}`}
        >
          <p className="text-sm font-black uppercase tracking-wide">{layout.name}</p>
        </button>
      ))}
    </div>
  );

  const renderLayouts = () => (
    <div className="grid grid-cols-1 xl:grid-cols-[272px_minmax(0,1fr)] gap-5 items-start">
      <div className="space-y-4 xl:sticky xl:top-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search layouts"
            className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-700"
          />
        </div>
        {renderLayoutList()}
        <div className="bg-white border border-slate-100 rounded-[20px] p-4 space-y-3">
          <p className="text-sm font-bold text-slate-900">Need a fresh canvas?</p>
          <p className="text-xs text-slate-500 leading-relaxed">Generate a blank drag-and-drop layout, give it a title, then tune the field placement.</p>
          <button onClick={handleAddLayout} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-[0.3em]">
            <Plus size={16} /> Create Layout
          </button>
        </div>
      </div>
      <div className="space-y-4 min-w-0">
        {workingLayout ? (
          <>
            <div className="bg-white border border-slate-100 rounded-[20px] p-3.5 flex flex-wrap gap-2">
              <button onClick={handleSaveLayout} className="px-4 py-2.5 rounded-xl bg-green-600 text-white text-[11px] font-black uppercase tracking-[0.3em] flex items-center gap-2">
                <Save size={16} /> Save Layout
              </button>
              <button onClick={handleDuplicateLayout} className="px-4 py-2.5 rounded-xl bg-slate-200 text-slate-900 text-[11px] font-black uppercase tracking-[0.3em] flex items-center gap-2">
                <Copy size={16} /> Duplicate
              </button>
              <button onClick={handleDeleteLayout} className="px-4 py-2.5 rounded-xl bg-red-50 text-red-600 text-[11px] font-black uppercase tracking-[0.3em] flex items-center gap-2">
                <Trash2 size={16} /> Remove
              </button>
            </div>
            <LayoutEditor layout={workingLayout} onChange={handleWorkingLayoutChange} settings={settings} onOpenAssets={handleOpenAssets} />
          </>
        ) : (
          <div className="bg-white border border-slate-100 rounded-[20px] p-8 text-center text-slate-400 text-sm">Select or create a layout to begin editing.</div>
        )}
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className="bg-white border border-slate-100 rounded-[24px] p-6 space-y-4">
        {(
          [
            { key: 'appName', label: 'App Name' },
            { key: 'businessName', label: 'Business Name' },
            { key: 'businessEmail', label: 'Support Email' },
            { key: 'businessPhone', label: 'Support Phone' },
            { key: 'businessAddress', label: 'Business Address' },
            { key: 'businessWebsite', label: 'Business Website' },
            { key: 'primaryColor', label: 'Primary Color' },
            { key: 'logoUrl', label: 'Logo URL' }
          ] as { key: keyof AppSettings; label: string }[]
        ).map(({ key, label }) => (
          <div key={key} className="space-y-2">
            <label className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">{label}</label>
            <input
              value={settingsForm[key]}
              onChange={(e) => setSettingsForm((prev) => ({ ...prev, [key]: e.target.value }))}
              className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-sm"
            />
          </div>
        ))}
        <button onClick={handleSettingsSave} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-[0.3em]">
          <Save size={16} /> Save Settings
        </button>
      </div>
      <div className="bg-slate-900 text-white rounded-[24px] p-8 space-y-5">
        <p className="text-[10px] font-black uppercase tracking-[0.35em] text-white/50">Preview Card</p>
        <div className="bg-white rounded-[24px] p-5">
          <BusinessCardPreviewPlaceholder settings={settingsForm} />
        </div>
        <p className="text-white/70 text-xs leading-relaxed">
          These settings control defaults for contact data and UI chrome across the entire experience. Updating them here persists for the next session.
        </p>
      </div>
    </div>
  );

  const renderAssets = () => (
    <div className="grid grid-cols-1 xl:grid-cols-[272px_minmax(0,1fr)] gap-5 items-start">
      <div className="space-y-4 xl:sticky xl:top-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search layouts"
            className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-700"
          />
        </div>
        {renderLayoutList()}
        <div className="bg-white border border-slate-100 rounded-[20px] p-4 space-y-3">
          <p className="text-sm font-bold text-slate-900">Shared assets follow the selected layout.</p>
          <p className="text-xs text-slate-500 leading-relaxed">Pick a layout here, then manage the fonts and swatches that should appear in its custom font and color selectors.</p>
        </div>
      </div>
      <div className="min-w-0">
        {workingLayout ? (
          <LayoutAssetsEditor layout={workingLayout} onChange={handleWorkingLayoutChange} />
        ) : (
          <div className="bg-white border border-slate-100 rounded-[20px] p-8 text-center text-slate-400 text-sm">Select a layout to manage its shared fonts and colors.</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <input
        ref={importFileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => handleImportData(e.target.files?.[0])}
      />
      <div className="flex flex-wrap items-center gap-3">
        {(
          [
            { key: 'overview', label: 'Overview' },
            { key: 'layouts', label: 'Layouts' },
            { key: 'assets', label: 'Fonts & Colors' },
            { key: 'settings', label: 'Settings' }
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-6 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-[0.3em] border ${activeTab === key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-500'}`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={handleExportData}
            className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-[11px] font-black uppercase tracking-[0.3em] text-slate-600 flex items-center gap-2"
          >
            <Download size={16} /> Export Layouts
          </button>
          <button
            onClick={handleImportClick}
            className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-[0.3em] flex items-center gap-2"
          >
            <Upload size={16} /> Import Layouts
          </button>
        </div>
      </div>
      {message && <p className="text-sm font-semibold text-green-600">{message}</p>}
      {error && <p className="text-sm font-semibold text-red-500">{error}</p>}
      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'layouts' && renderLayouts()}
      {activeTab === 'assets' && renderAssets()}
      {activeTab === 'settings' && renderSettings()}
    </div>
  );
};

const BusinessCardPreviewPlaceholder: React.FC<{ settings: AppSettings }> = ({ settings }) => {
  return (
    <div className="space-y-3 text-slate-700">
      <div className="h-3 w-40 rounded-full bg-slate-200" />
      <div className="h-3 w-64 rounded-full bg-slate-200" />
      <div className="h-3 w-56 rounded-full bg-slate-200" />
      <p className="text-xs text-slate-500">{settings.businessName}</p>
    </div>
  );
};

export default AdminDashboard;
