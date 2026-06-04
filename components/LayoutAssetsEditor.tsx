import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layout, FontAsset, CMYK, ColorPreset, RGB, SideLayout } from '../types';
import { cmykToHex, cmykToRgb, hexToCmyk, hexToRgb, normalizeCmyk, normalizeHex, normalizeRgb, rgbToCmyk, rgbToHex } from '../utils/color';

interface LayoutAssetsEditorProps {
  layout: Layout;
  onChange: (layout: Layout) => void;
}

const cloneLayout = (layout: Layout): Layout => JSON.parse(JSON.stringify(layout));
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const parseNumericInput = (value: string, max: number) => {
  const digitsOnly = value.replace(/[^0-9]/g, '');
  if (!digitsOnly) return 0;
  return clamp(Number(digitsOnly), 0, max);
};

const FONT_FILE_ACCEPT = '.woff,.woff2,.ttf,.otf';
const FONT_EXTENSION_MAP: Record<string, FontAsset['format']> = {
  woff: 'woff',
  woff2: 'woff2',
  ttf: 'truetype',
  otf: 'opentype'
};
const DEFAULT_PRESET_CMYK: CMYK = { c: 75, m: 50, y: 0, k: 35 };
const DEFAULT_PRESET_RGB = cmykToRgb(DEFAULT_PRESET_CMYK) || { r: 41, g: 83, b: 166 };
const DEFAULT_PRESET_HEX = cmykToHex(DEFAULT_PRESET_CMYK) || '#2953A6';

const formatCmykLabel = (cmyk: CMYK) => `C${cmyk.c} M${cmyk.m} Y${cmyk.y} K${cmyk.k}`;
const formatRgbLabel = (rgb?: RGB) => rgb ? `RGB ${rgb.r}, ${rgb.g}, ${rgb.b}` : null;
const formatPresetLabel = (preset: ColorPreset) => preset.name || preset.pantone || formatCmykLabel(preset.cmyk);

const detectFontFormat = (fileName: string): FontAsset['format'] | null => {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return FONT_EXTENSION_MAP[ext] ?? null;
};

const formatFontName = (fileName: string) => {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Custom Font';
};

const LayoutAssetsEditor: React.FC<LayoutAssetsEditorProps> = ({ layout, onChange }) => {
  const [activeSide, setActiveSide] = useState<'front' | 'back'>('front');
  const [customFontInput, setCustomFontInput] = useState('');
  const [presetColorInput, setPresetColorInput] = useState<CMYK>(DEFAULT_PRESET_CMYK);
  const [presetHexInput, setPresetHexInput] = useState(DEFAULT_PRESET_HEX);
  const [presetRgbInput, setPresetRgbInput] = useState<RGB>(DEFAULT_PRESET_RGB);
  const [presetPantoneInput, setPresetPantoneInput] = useState('');
  const [presetNotesInput, setPresetNotesInput] = useState('');
  const [presetColorLabel, setPresetColorLabel] = useState('');
  const fontFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeSide === 'back' && !layout.back) {
      setActiveSide('front');
    }
  }, [activeSide, layout.back]);

  const commitLayout = (mutator: (draft: Layout) => void) => {
    const draft = cloneLayout(layout);
    mutator(draft);
    onChange(draft);
  };

  const activeSideLayout: SideLayout = activeSide === 'back' && layout.back ? layout.back : layout.front;
  const colorPresets = layout.colorPresets || [];
  const selectedBackgroundPresetId = useMemo(() => {
    const normalized = normalizeCmyk(activeSideLayout.cmykBackgroundColor || { c: 0, m: 0, y: 0, k: 0 });
    return colorPresets.find((preset) => {
      const current = normalizeCmyk(preset.cmyk);
      return current.c === normalized.c && current.m === normalized.m && current.y === normalized.y && current.k === normalized.k;
    })?.id || '';
  }, [activeSideLayout.cmykBackgroundColor, colorPresets]);

  const handleAddCustomFont = () => {
    const cleaned = customFontInput.trim();
    if (!cleaned) return;
    commitLayout((draft) => {
      const nextFonts = new Set(draft.customFonts || []);
      nextFonts.add(cleaned);
      draft.customFonts = Array.from(nextFonts);
    });
    setCustomFontInput('');
  };

  const handleRemoveCustomFont = (font: string) => {
    commitLayout((draft) => {
      const remaining = (draft.customFonts || []).filter((entry) => entry !== font);
      draft.customFonts = remaining.length ? remaining : undefined;
    });
  };

  const handleFontUpload = (file?: File) => {
    if (!file) return;
    const format = detectFontFormat(file.name);
    if (!format) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const friendlyName = formatFontName(file.name);
      commitLayout((draft) => {
        const assets = draft.fontAssets ? [...draft.fontAssets] : [];
        const existingIndex = assets.findIndex((asset) => asset.name === friendlyName);
        const assetId = existingIndex >= 0 ? assets[existingIndex].id : `font-${Date.now()}`;
        const nextAsset: FontAsset = { id: assetId, name: friendlyName, dataUrl, format };
        if (existingIndex >= 0) {
          assets[existingIndex] = nextAsset;
        } else {
          assets.push(nextAsset);
        }
        draft.fontAssets = assets;
        const nextFonts = new Set(draft.customFonts || []);
        nextFonts.add(friendlyName);
        draft.customFonts = Array.from(nextFonts);
      });
      if (fontFileInputRef.current) {
        fontFileInputRef.current.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveFontAsset = (assetId: string, fontName?: string) => {
    commitLayout((draft) => {
      const before = draft.fontAssets?.length || 0;
      draft.fontAssets = (draft.fontAssets || []).filter((asset) => asset.id !== assetId);
      if (before > 0 && !draft.fontAssets?.length) {
        draft.fontAssets = undefined;
      }
      if (fontName) {
        const remainingFonts = (draft.customFonts || []).filter((entry) => entry !== fontName);
        draft.customFonts = remainingFonts.length ? remainingFonts : undefined;
      }
    });
  };

  const handleAddColorPreset = () => {
    const normalizedCmyk = normalizeCmyk(presetColorInput);
    const normalizedHex = normalizeHex(presetHexInput) || normalizeHex(cmykToHex(normalizedCmyk));
    const normalizedRgb = normalizeRgb(presetRgbInput || cmykToRgb(normalizedCmyk) || undefined);
    commitLayout((draft) => {
      const next = [...(draft.colorPresets || [])];
      next.push({
        id: `preset-${Date.now()}`,
        name: presetColorLabel.trim() || undefined,
        cmyk: normalizedCmyk,
        hex: normalizedHex || undefined,
        rgb: normalizedRgb,
        pantone: presetPantoneInput.trim() || undefined,
        notes: presetNotesInput.trim() || undefined
      });
      draft.colorPresets = next;
    });
    setPresetColorLabel('');
    setPresetPantoneInput('');
    setPresetNotesInput('');
    setPresetColorInput(DEFAULT_PRESET_CMYK);
    setPresetHexInput(DEFAULT_PRESET_HEX);
    setPresetRgbInput(DEFAULT_PRESET_RGB);
  };

  const handleRemoveColorPreset = (presetId: string) => {
    commitLayout((draft) => {
      const remaining = (draft.colorPresets || []).filter((entry) => entry.id !== presetId);
      draft.colorPresets = remaining.length ? remaining : undefined;
    });
  };

  const handleApplyColorPreset = (preset: ColorPreset) => {
    commitLayout((draft) => {
      const targetSide = activeSide === 'back' ? draft.back ?? draft.front : draft.front;
      if (!targetSide) return;
      const normalized = normalizeCmyk(preset.cmyk);
      targetSide.cmykBackgroundColor = normalized;
      targetSide.backgroundColor = cmykToHex(normalized) || targetSide.backgroundColor;
    });
  };

  const handlePresetCmykChange = (channel: keyof CMYK, value: number) => {
    setPresetColorInput((current) => {
      return normalizeCmyk({ ...current, [channel]: clamp(value, 0, 100) });
    });
  };

  const handlePresetHexChange = (value: string) => {
    setPresetHexInput(value);
  };

  const handlePresetRgbChange = (channel: keyof RGB, value: number) => {
    setPresetRgbInput((current) => {
      return normalizeRgb({ ...current, [channel]: clamp(value, 0, 255) });
    });
  };

  return (
    <div className="space-y-5">
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-400">Layout Assets</p>
            <h3 className="mt-2 text-2xl font-black text-slate-900">{layout.name}</h3>
            <p className="mt-1 text-sm text-slate-500">Manage the shared fonts and swatches once here. They stay available inside the custom font and color selectors for this layout.</p>
          </div>
          <div className="flex gap-2 text-[10px] font-black uppercase tracking-[0.3em]">
            <button type="button" onClick={() => setActiveSide('front')} className={`px-3 py-2 rounded-xl border ${activeSide === 'front' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}>
              Front
            </button>
            <button type="button" onClick={() => layout.back && setActiveSide('back')} disabled={!layout.back} className={`px-3 py-2 rounded-xl border ${activeSide === 'back' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'} ${!layout.back ? 'cursor-not-allowed opacity-50' : ''}`}>
              Back
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.25em] text-slate-500">Shared Fonts</p>
            <p className="mt-1 text-xs text-slate-500">Anything added here appears in the custom font picker while editing fields.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
            <label className="text-xs font-semibold text-slate-500">Add Font Name
              <input value={customFontInput} onChange={(e) => setCustomFontInput(e.target.value)} placeholder="e.g. Gotham, Avenir Next" className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800" />
            </label>
            <button type="button" onClick={handleAddCustomFont} className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-[0.25em]">Add Font</button>
          </div>
          <label className="block text-xs font-semibold text-slate-500">Upload Font File
            <input ref={fontFileInputRef} type="file" accept={FONT_FILE_ACCEPT} onChange={(e) => handleFontUpload(e.target.files?.[0])} className="mt-1.5 block w-full text-[11px] text-slate-600" />
            <span className="mt-1 block text-[11px] text-slate-400">Supported formats: WOFF, WOFF2, TTF, and OTF.</span>
          </label>
          {(layout.customFonts?.length || layout.fontAssets?.length) ? (
            <div className="flex flex-wrap gap-2">
              {(layout.customFonts || []).map((font) => {
                const asset = (layout.fontAssets || []).find((entry) => entry.name === font);
                return (
                  <div key={font} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-700">{font}</p>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">{asset ? 'Uploaded' : 'Manual'}</p>
                    </div>
                    <button type="button" onClick={() => asset ? handleRemoveFontAsset(asset.id, font) : handleRemoveCustomFont(font)} className="text-sm text-slate-400">×</button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No extra fonts added yet for this layout.</p>
          )}
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.25em] text-slate-500">Shared Colors</p>
            <p className="mt-1 text-xs text-slate-500">Save approved swatches here with every brand reference you have. Hex and RGB drive the screen preview, while CMYK and Pantone stay attached for print handoff.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-slate-500">Swatch Name
              <input value={presetColorLabel} onChange={(e) => setPresetColorLabel(e.target.value)} placeholder="e.g. Holiday Inn Green" className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800" />
            </label>
            <label className="block text-xs font-semibold text-slate-500">Pantone / Spot
              <input value={presetPantoneInput} onChange={(e) => setPresetPantoneInput(e.target.value)} placeholder="e.g. Pantone 356 C" className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800" />
            </label>
          </div>
          <div className="space-y-4">
            <label className="block text-xs font-semibold text-slate-500">HEX
              <input value={presetHexInput} onChange={(e) => handlePresetHexChange(e.target.value)} placeholder="#2953A6" className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800" />
            </label>
            <div>
              <p className="text-xs font-semibold text-slate-500">RGB</p>
              <div className="mt-1.5 grid grid-cols-3 gap-3">
                {(['r', 'g', 'b'] as const).map((channel) => (
                  <label key={channel} className="min-w-0 text-[11px] font-semibold text-slate-400 uppercase">{channel}
                    <input type="text" inputMode="numeric" pattern="[0-9]*" value={presetRgbInput[channel]} onChange={(e) => handlePresetRgbChange(channel, parseNumericInput(e.target.value, 255))} className="mt-1 w-full min-w-0 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-base font-semibold tabular-nums text-slate-800" />
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500">CMYK</p>
              <div className="mt-1.5 grid grid-cols-2 gap-3">
                {(['c', 'm', 'y', 'k'] as const).map((channel) => (
                  <label key={channel} className="min-w-0 text-[11px] font-semibold text-slate-400 uppercase">{channel}
                    <input type="text" inputMode="numeric" pattern="[0-9]*" value={presetColorInput[channel]} onChange={(e) => handlePresetCmykChange(channel, parseNumericInput(e.target.value, 100))} className="mt-1 w-full min-w-0 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-base font-semibold tabular-nums text-slate-800" />
                  </label>
                ))}
              </div>
            </div>
          </div>
          <label className="block text-xs font-semibold text-slate-500">Notes
            <input value={presetNotesInput} onChange={(e) => setPresetNotesInput(e.target.value)} placeholder="e.g. Hotel master brand primary green" className="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800" />
          </label>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-3">
            <span className="w-10 h-10 rounded-full border border-slate-300 shrink-0" style={{ backgroundColor: normalizeHex(presetHexInput) || cmykToHex(presetColorInput) || '#000000' }} />
            <div className="text-xs text-slate-500 space-y-1">
              <p className="font-semibold text-slate-700">{presetColorLabel || presetPantoneInput || 'Swatch preview'}</p>
              <p>{normalizeHex(presetHexInput) || 'Enter a valid Hex value'}</p>
              <p>{formatRgbLabel(presetRgbInput)} · {formatCmykLabel(normalizeCmyk(presetColorInput))}</p>
              <p>Pantone is reference-only here; preview/application still uses the matched Hex/RGB/CMYK value.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <button type="button" onClick={handleAddColorPreset} className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-[0.25em]">Save Swatch</button>
            <label className="text-xs font-semibold text-slate-500">Apply To {activeSide} Background
              <select value={selectedBackgroundPresetId} onChange={(e) => {
                const preset = colorPresets.find((entry) => entry.id === e.target.value);
                if (preset) handleApplyColorPreset(preset);
              }} className="mt-1.5 min-w-[220px] px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800">
                <option value="">Choose a saved swatch</option>
                {colorPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>{formatPresetLabel(preset)}</option>
                ))}
              </select>
            </label>
          </div>
          {colorPresets.length ? (
            <div className="grid grid-cols-1 gap-3">
              {colorPresets.map((preset) => (
                <div key={preset.id} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="w-8 h-8 rounded-full border shrink-0" style={{ backgroundColor: preset.hex || cmykToHex(preset.cmyk) || '#000000' }} />
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => handleApplyColorPreset(preset)} className="text-sm font-semibold text-slate-700 text-left">{formatPresetLabel(preset)}</button>
                    <p className="mt-1 text-[11px] text-slate-500">{preset.hex || cmykToHex(preset.cmyk) || 'No Hex'}{preset.rgb ? ` · ${formatRgbLabel(preset.rgb)}` : ''}</p>
                    <p className="mt-1 text-[11px] text-slate-500">{formatCmykLabel(preset.cmyk)}{preset.pantone ? ` · ${preset.pantone}` : ''}</p>
                    {preset.notes && <p className="mt-1 text-[11px] text-slate-400">{preset.notes}</p>}
                  </div>
                  <button type="button" className="text-sm text-slate-400 shrink-0" onClick={() => handleRemoveColorPreset(preset.id)}>×</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No saved swatches yet for this layout.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default LayoutAssetsEditor;