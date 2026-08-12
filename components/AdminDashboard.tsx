import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppSettings, BrandConfig, Layout, PhoneNumberTypeOption } from '../types';
import LayoutEditor from './LayoutEditor';
import LayoutAssetsEditor from './LayoutAssetsEditor';
import { Search, Plus, Save, Trash2, Copy, Download, Upload, ExternalLink, FileText, LayoutTemplate, Palette, Settings as SettingsIcon } from 'lucide-react';
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

interface ProofRecord {
  reference: string;
  proofUrl: string;
  createdAt: string;
  layoutId?: string;
  layoutName?: string;
  productHandle?: string;
  returnUrl?: string;
  selectedVariant?: {
    id?: number | null;
    title?: string;
    price?: number | null;
    available?: boolean | null;
  } | null;
  cardData?: Record<string, unknown> | null;
  emailed?: boolean;
  notificationTarget?: string;
}

const createBlankBrandConfig = (brand: string): BrandConfig => ({
  primaryColor: '#0f172a',
  secondaryColor: '#ffffff',
  accentColor: '#0284c7',
  logo: '',
  layouts: []
});

const DEFAULT_PHONE_TYPE_OPTIONS: PhoneNumberTypeOption[] = [
  { label: 'T: Telephone', value: 'Telephone', code: 'T' },
  { label: 'D: Direct', value: 'Direct', code: 'D' },
  { label: 'M: Mobile', value: 'Mobile', code: 'M' },
  { label: 'C: Cell', value: 'Cell', code: 'C' },
  { label: 'F: Fax', value: 'Fax', code: 'F' }
];

const createLayoutTemplate = (brand: string, groupId: string): Layout => ({
  id: `layout-${Date.now()}`,
  brand,
  canvasVersion: CARD_CANVAS_VERSION,
  name: 'Untitled Layout',
  customerVisible: true,
  previewUrl: '',
  phoneNumberConfig: {
    maxPhones: 1,
    allowedTypes: DEFAULT_PHONE_TYPE_OPTIONS,
    variationPrefix: '',
    variantGroupId: groupId
  },
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
const LEGACY_UNGROUPED_ID = '__ungrouped__';
const normalizeGroupId = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '-');
const getLayoutGroupId = (layout: Layout) => normalizeGroupId(layout.phoneNumberConfig?.variantGroupId || '');
const formatGroupLabel = (groupId: string) => groupId.split('-').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || 'Ungrouped';
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

const hasRequiredSideMedia = (layout: Layout) => {
  const frontHasTemplate = Boolean(layout.front.backgroundPdf || layout.front.backgroundImage);
  const frontHasPreview = Boolean(layout.front.previewImage || layout.previewImage);
  if (!frontHasTemplate || !frontHasPreview) {
    return {
      valid: false,
      reason: 'Front side requires both a print template and a preview image before saving.'
    };
  }

  if (layout.back) {
    const backHasTemplate = Boolean(layout.back.backgroundPdf || layout.back.backgroundImage);
    const backHasPreview = Boolean(layout.back.previewImage);
    if (!backHasTemplate || !backHasPreview) {
      return {
        valid: false,
        reason: 'Back side is enabled, so it also requires both a print template and a preview image before saving.'
      };
    }
  }

  return { valid: true, reason: '' };
};

const normalizeSide = (side: Layout['front']) => {
  const existingKeys = Object.keys(side.fields || {});
  const declaredOrder = side.fieldOrder || [];
  const stableDeclared = declaredOrder.filter((key, index) => declaredOrder.indexOf(key) === index && side.fields[key]);
  const missing = existingKeys.filter((key) => !stableDeclared.includes(key));
  return {
    ...side,
    fieldOrder: [...stableDeclared, ...missing]
  };
};

const normalizeLayoutForSave = (layout: Layout): Layout => {
  const frontPreviewImage = layout.front.previewImage || layout.previewImage;
  const frontPreviewImageName = layout.front.previewImageName || layout.previewImageName;

  return {
    ...layout,
    front: {
      ...normalizeSide(layout.front),
      previewImage: frontPreviewImage,
      previewImageName: frontPreviewImageName
    },
    back: layout.back ? normalizeSide(layout.back) : undefined
  };
};

const AdminDashboard: React.FC<AdminDashboardProps> = ({ brandConfigs, onBrandConfigsChange, settings, onSettingsChange }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'layouts' | 'assets' | 'operations' | 'settings'>('overview');
  const [search, setSearch] = useState('');
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
  const [workingLayout, setWorkingLayout] = useState<Layout | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState(settings);
  const [proofRecords, setProofRecords] = useState<ProofRecord[]>([]);
  const [proofStatus, setProofStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [proofSearch, setProofSearch] = useState('');
  const [proofEmailFilter, setProofEmailFilter] = useState<'all' | 'sent' | 'unsent'>('all');
  const [proofRefreshToken, setProofRefreshToken] = useState(0);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
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

  useEffect(() => {
    if (activeTab !== 'operations') return;
    let cancelled = false;

    const loadProofs = async () => {
      setProofStatus('loading');
      try {
        const response = await fetch('/api/proofs', { credentials: 'include' });
        if (!response.ok) {
          throw new Error(`Unable to load proofs: ${response.status}`);
        }
        const payload = await response.json();
        if (cancelled) return;
        setProofRecords(Array.isArray(payload?.proofs) ? payload.proofs : []);
        setProofStatus('ready');
      } catch (loadError) {
        console.error('Unable to load proof registry.', loadError);
        if (cancelled) return;
        setProofRecords([]);
        setProofStatus('error');
      }
    };

    loadProofs();

    return () => {
      cancelled = true;
    };
  }, [activeTab, proofRefreshToken]);

  const filteredLayouts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return allLayouts;
    return allLayouts.filter((layout) => layout.name.toLowerCase().includes(query));
  }, [allLayouts, search]);

  const availableGroupIds = useMemo(() => {
    const ids = new Set<string>();
    allLayouts.forEach((layout) => {
      const groupId = getLayoutGroupId(layout);
      if (groupId) ids.add(groupId);
    });
    if (selectedGroupId) {
      ids.add(selectedGroupId);
    }
    return Array.from(ids).sort((left, right) => left.localeCompare(right));
  }, [allLayouts, selectedGroupId]);

  const groupedFilteredLayouts = useMemo(() => {
    return filteredLayouts.reduce<Record<string, Layout[]>>((acc, layout) => {
      const groupId = getLayoutGroupId(layout) || 'ungrouped';
      if (!acc[groupId]) acc[groupId] = [];
      acc[groupId].push(layout);
      return acc;
    }, {});
  }, [filteredLayouts]);

  useEffect(() => {
    if (selectedGroupId && availableGroupIds.includes(selectedGroupId)) return;
    setSelectedGroupId(availableGroupIds[0] || '');
  }, [availableGroupIds, selectedGroupId]);

  const filteredProofRecords = useMemo(() => {
    const query = proofSearch.trim().toLowerCase();
    return proofRecords.filter((proof) => {
      const emailMatches = proofEmailFilter === 'all'
        ? true
        : proofEmailFilter === 'sent'
          ? Boolean(proof.emailed)
          : !proof.emailed;

      if (!emailMatches) return false;
      if (!query) return true;

      const haystack = [
        proof.reference,
        proof.layoutName,
        proof.layoutId,
        proof.productHandle,
        proof.selectedVariant?.title,
        proof.notificationTarget,
        proof.returnUrl,
        ...(proof.cardData ? Object.values(proof.cardData).map((value) => typeof value === 'string' ? value : JSON.stringify(value)) : [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [proofEmailFilter, proofRecords, proofSearch]);

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
    const normalizedGroupId = normalizeGroupId(selectedGroupId);
    if (!normalizedGroupId) {
      pushError('Create and select a layout group before creating a new layout.');
      return;
    }
    const brand = getDefaultBrandKey();
    const template = createLayoutTemplate(brand, normalizedGroupId);
    const clone = cloneConfigs(brandConfigs);
    ensureBrandBucket(clone, brand);
    clone[brand].layouts = [...clone[brand].layouts, template];
    onBrandConfigsChange(clone);
    setSelectedLayoutId(template.id);
    setWorkingLayout(cloneLayout(template));
    pushMessage('Layout scaffold generated.');
  };

  const handleCreateGroup = () => {
    const normalizedGroupId = normalizeGroupId(newGroupName);
    if (!normalizedGroupId) {
      pushError('Enter a group name first.');
      return;
    }
    setSelectedGroupId(normalizedGroupId);
    setExpandedGroups((prev) => ({ ...prev, [normalizedGroupId]: true }));
    setNewGroupName('');
    pushMessage(`Group ${formatGroupLabel(normalizedGroupId)} is ready. Create layouts inside it.`);
  };

  const handleAssignWorkingLayoutGroup = (groupId: string) => {
    if (!workingLayout) return;
    const normalizedGroupId = normalizeGroupId(groupId);
    if (!normalizedGroupId) return;

    const nextLayout: Layout = {
      ...workingLayout,
      phoneNumberConfig: {
        maxPhones: workingLayout.phoneNumberConfig?.maxPhones || 1,
        allowedTypes: workingLayout.phoneNumberConfig?.allowedTypes?.length ? workingLayout.phoneNumberConfig.allowedTypes : DEFAULT_PHONE_TYPE_OPTIONS,
        variationPrefix: workingLayout.phoneNumberConfig?.variationPrefix || '',
        variantGroupId: normalizedGroupId
      }
    };

    setSelectedGroupId(normalizedGroupId);
    setExpandedGroups((prev) => ({ ...prev, [normalizedGroupId]: true }));
    handleWorkingLayoutChange(nextLayout);
    setWorkingLayout(nextLayout);
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
    const normalizedLayout = normalizeLayoutForSave(workingLayout);
    const mediaValidation = hasRequiredSideMedia(normalizedLayout);
    if (!mediaValidation.valid) {
      pushError(mediaValidation.reason);
      return;
    }
    const brand = workingLayout.brand?.toString() || getDefaultBrandKey();
    const clone = cloneConfigs(brandConfigs);
    Object.keys(clone).forEach((brandKey) => {
      clone[brandKey].layouts = clone[brandKey].layouts.filter((layout) => layout.id !== workingLayout.id);
    });
    ensureBrandBucket(clone, brand);
    clone[brand].layouts = [...clone[brand].layouts, cloneLayout({ ...normalizedLayout, name: trimmedName })];
    onBrandConfigsChange(clone);
    setSelectedLayoutId(workingLayout.id);
    setWorkingLayout((current) => (current ? { ...normalizedLayout, name: trimmedName } : current));
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

  const handleResetServerLayouts = async () => {
    const confirmed = window.confirm('This will clear saved layouts on the server for this deployment. Continue?');
    if (!confirmed) return;

    try {
      const response = await fetch('/api/layouts', {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`Unable to clear server layouts: ${response.status}`);
      }

      pushMessage('Server layout storage cleared. Reloading…');
      window.location.reload();
    } catch (resetError) {
      console.error('Unable to clear server layouts.', resetError);
      pushError('Unable to clear server layout storage. Confirm admin login and try again.');
    }
  };

  const totalLayouts = allLayouts.length;
  const taggedLayouts = allLayouts.filter((layout) => (layout.shopifyTags?.length || 0) > 0).length;
  const untaggedLayouts = Math.max(totalLayouts - taggedLayouts, 0);
  const totalProofs = proofRecords.length;
  const linkedProducts = allLayouts.filter((layout) => layout.shopifyProductHandle).length;
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
        <p className="text-slate-400 text-[11px] font-black uppercase tracking-[0.35em]">Linked Layouts</p>
        <p className="text-4xl font-black text-slate-900 mt-3">{linkedProducts}</p>
        <p className="text-xs text-slate-400 mt-1">Layouts assigned to a Shopify product</p>
      </div>
    </div>
  );

  const renderLayoutList = () => (
    <div className="bg-white border border-slate-100 rounded-[20px] p-3 space-y-2.5 max-h-[360px] overflow-y-auto">
      {filteredLayouts.length === 0 && <p className="text-center text-slate-400 text-sm">No layouts match that search.</p>}
      {Object.entries(groupedFilteredLayouts).sort(([left], [right]) => left.localeCompare(right)).map(([groupId, layouts]) => {
        const isExpanded = expandedGroups[groupId] ?? groupId === selectedGroupId;
        return (
          <div key={groupId} className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5 space-y-2">
            <button
              type="button"
              onClick={() => {
                setExpandedGroups((prev) => ({ ...prev, [groupId]: !isExpanded }));
                setSelectedGroupId(groupId);
              }}
              className="w-full flex items-center justify-between px-2 py-1.5 text-left"
            >
              <span className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">{formatGroupLabel(groupId)}</span>
              <span className="text-[11px] font-semibold text-slate-400">{layouts.length}</span>
            </button>
            {isExpanded && layouts.map((layout) => (
              <button
                key={layout.id}
                onClick={() => handleSelectLayout(layout.id)}
                className={`w-full text-left p-3 rounded-2xl border transition-all ${selectedLayoutId === layout.id ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-transparent bg-white text-slate-600'}`}
              >
                <p className="text-sm font-black uppercase tracking-wide">{layout.name}</p>
              </button>
            ))}
          </div>
        );
      })}
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
          <p className="text-sm font-bold text-slate-900">Create Group First</p>
          <p className="text-xs text-slate-500 leading-relaxed">Create/select a group, then add all layout variations into that same group.</p>
          <div className="space-y-2">
            <input
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder="New group name"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm"
            />
            <button onClick={handleCreateGroup} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-200 bg-white text-[11px] font-black uppercase tracking-[0.3em] text-slate-700">
              Create Group
            </button>
            <select
              value={selectedGroupId}
              onChange={(event) => setSelectedGroupId(normalizeGroupId(event.target.value))}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm"
            >
              {!availableGroupIds.length && <option value="">No groups yet</option>}
              {availableGroupIds.map((groupId) => (
                <option key={groupId} value={groupId}>{formatGroupLabel(groupId)}</option>
              ))}
            </select>
          </div>
          <button onClick={handleAddLayout} disabled={!selectedGroupId} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 text-white text-[11px] font-black uppercase tracking-[0.3em] disabled:opacity-50 disabled:cursor-not-allowed">
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
              <select
                value={getLayoutGroupId(workingLayout) || LEGACY_UNGROUPED_ID}
                onChange={(event) => {
                  if (event.target.value === LEGACY_UNGROUPED_ID) return;
                  handleAssignWorkingLayoutGroup(event.target.value);
                }}
                className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-[11px] font-black uppercase tracking-[0.18em] text-slate-600"
              >
                {!getLayoutGroupId(workingLayout) && (
                  <option value={LEGACY_UNGROUPED_ID}>Ungrouped (legacy)</option>
                )}
                {availableGroupIds.map((groupId) => (
                  <option key={groupId} value={groupId}>{formatGroupLabel(groupId)}</option>
                ))}
              </select>
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

  const renderOperations = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-[28px] bg-white border border-slate-100 shadow-xl">
          <p className="text-slate-400 text-[11px] font-black uppercase tracking-[0.35em]">Stored Proofs</p>
          <p className="text-4xl font-black text-slate-900 mt-3">{totalProofs}</p>
          <p className="text-xs text-slate-400 mt-1">Print-ready PDFs recorded by this app</p>
        </div>
        <div className="p-6 rounded-[28px] bg-white border border-slate-100 shadow-xl">
          <p className="text-slate-400 text-[11px] font-black uppercase tracking-[0.35em]">Linked Layouts</p>
          <p className="text-4xl font-black text-slate-900 mt-3">{linkedProducts}</p>
          <p className="text-xs text-slate-400 mt-1">Layouts assigned to Shopify products</p>
        </div>
        <div className="p-6 rounded-[28px] bg-white border border-slate-100 shadow-xl">
          <p className="text-slate-400 text-[11px] font-black uppercase tracking-[0.35em]">App Base</p>
          <p className="text-base font-black text-slate-900 mt-3 break-all">{typeof window !== 'undefined' ? window.location.origin : 'Current host'}</p>
          <p className="text-xs text-slate-400 mt-1">Use this URL as the admin app destination/link target</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-5 items-start">
        <div className="space-y-4 xl:sticky xl:top-4">
          <div className="bg-white border border-slate-100 rounded-[24px] p-5 space-y-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Quick Links</p>
              <p className="mt-2 text-sm text-slate-500">Jump to the parts of the app an operator needs most often.</p>
            </div>
            <button onClick={() => setActiveTab('layouts')} className="w-full flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-800">
              <span className="flex items-center gap-3"><LayoutTemplate size={18} /> Build Layouts</span>
              <ExternalLink size={16} />
            </button>
            <button onClick={() => setActiveTab('assets')} className="w-full flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-800">
              <span className="flex items-center gap-3"><Palette size={18} /> Fonts & Colors</span>
              <ExternalLink size={16} />
            </button>
            <button onClick={() => setActiveTab('settings')} className="w-full flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-800">
              <span className="flex items-center gap-3"><SettingsIcon size={18} /> App Settings</span>
              <ExternalLink size={16} />
            </button>
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 space-y-2">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-red-600">Recovery</p>
              <p className="text-xs text-red-700">Use this if old/deleted layouts keep reappearing from stale server storage.</p>
              <button
                onClick={handleResetServerLayouts}
                className="w-full rounded-xl border border-red-300 bg-white px-3 py-2.5 text-[11px] font-black uppercase tracking-[0.24em] text-red-700"
              >
                Reset Server Layout Storage
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4 min-w-0">
          <div className="bg-white border border-slate-100 rounded-[24px] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-slate-900">Proof Registry</p>
                <p className="text-xs text-slate-500 mt-1">Every print-ready PDF the app stored, with links back to the file and related layout metadata.</p>
              </div>
              <button onClick={() => setProofRefreshToken((value) => value + 1)} className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-[11px] font-black uppercase tracking-[0.24em] text-slate-600">
                Refresh
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_200px] gap-3">
              <input
                value={proofSearch}
                onChange={(e) => setProofSearch(e.target.value)}
                placeholder="Search by proof, layout, product handle, variant, or entered data"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800"
              />
              <select
                value={proofEmailFilter}
                onChange={(e) => setProofEmailFilter(e.target.value as 'all' | 'sent' | 'unsent')}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800"
              >
                <option value="all">All Email States</option>
                <option value="sent">Emailed</option>
                <option value="unsent">Not Emailed</option>
              </select>
            </div>

            {proofStatus === 'loading' && <p className="text-sm text-slate-500">Loading proofs…</p>}
            {proofStatus === 'error' && <p className="text-sm text-red-500">Unable to load proofs right now.</p>}
            {proofStatus === 'ready' && proofRecords.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                No print-ready PDFs have been recorded yet.
              </div>
            )}
            {proofStatus === 'ready' && proofRecords.length > 0 && filteredProofRecords.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                No proofs match the current filters.
              </div>
            )}

            {filteredProofRecords.length > 0 && (
              <div className="space-y-3">
                {filteredProofRecords.map((proof) => (
                  <div key={proof.reference} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">{proof.layoutName || proof.reference}</p>
                        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">{proof.reference}</p>
                      </div>
                      <a href={proof.proofUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-slate-700">
                        <FileText size={14} /> Open PDF
                      </a>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-600">
                      <div><span className="font-black uppercase tracking-[0.18em] text-slate-400">Created</span><p className="mt-1 text-sm text-slate-800">{proof.createdAt ? new Date(proof.createdAt).toLocaleString() : 'Unknown'}</p></div>
                      <div><span className="font-black uppercase tracking-[0.18em] text-slate-400">Product Handle</span><p className="mt-1 text-sm text-slate-800">{proof.productHandle || 'Not captured'}</p></div>
                      <div><span className="font-black uppercase tracking-[0.18em] text-slate-400">Variant</span><p className="mt-1 text-sm text-slate-800">{proof.selectedVariant?.title || 'Not captured'}</p></div>
                      <div><span className="font-black uppercase tracking-[0.18em] text-slate-400">Email Status</span><p className="mt-1 text-sm text-slate-800">{proof.emailed ? `Sent to ${proof.notificationTarget || 'configured recipient'}` : 'Not emailed / email unavailable'}</p></div>
                    </div>
                    {proof.returnUrl && (
                      <a href={proof.returnUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-xs font-semibold text-blue-600">
                        Open Shopify product page <ExternalLink size={14} />
                      </a>
                    )}
                    {proof.cardData && Object.keys(proof.cardData).length > 0 && (
                      <details className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                        <summary className="cursor-pointer text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Entered Card Data</summary>
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-700">
                          {Object.entries(proof.cardData).map(([key, value]) => {
                            if (value == null || value === '') return null;
                            return (
                              <div key={`${proof.reference}-${key}`} className="rounded-lg bg-slate-50 px-3 py-2">
                                <p className="font-black uppercase tracking-[0.18em] text-slate-400">{key}</p>
                                <p className="mt-1 break-words text-slate-800">{typeof value === 'string' ? value : JSON.stringify(value)}</p>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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
            { key: 'operations', label: 'Operations' },
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
      {activeTab === 'operations' && renderOperations()}
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
