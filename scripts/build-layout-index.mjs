import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const rootDir = path.resolve(process.cwd());
const tmpDir = path.join(rootDir, '.bcard-cache');
const bundledFile = path.join(tmpDir, 'brand-configs.mjs');
const publicDir = path.join(rootDir, 'public');
const outputFile = path.join(publicDir, 'layout-index.json');
const storedLayoutsFile = path.join(rootDir, 'data', 'brand-configs.json');

async function ensureTmpBundle() {
  await fs.mkdir(tmpDir, { recursive: true });
  await build({
    entryPoints: [path.join(rootDir, 'constants.ts')],
    outfile: bundledFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    sourcemap: false,
    target: 'es2020',
    logLevel: 'silent'
  });
}

async function readStoredBrandConfigs() {
  try {
    const raw = await fs.readFile(storedLayoutsFile, 'utf8');
    const payload = JSON.parse(raw);
    const configs = payload?.brandConfigs;
    if (!configs || typeof configs !== 'object' || Array.isArray(configs)) {
      return null;
    }
    return configs;
  } catch {
    return null;
  }
}

function mapLayouts(configs) {
  return Object.entries(configs || {}).flatMap(([brandKey, config]) => {
    const list = Array.isArray(config?.layouts) ? config.layouts : [];
    return list.map((layout) => ({
      id: layout?.id,
      name: layout?.name,
      brand: layout?.brand ?? brandKey,
      shopifyTags: Array.isArray(layout?.shopifyTags) ? layout.shopifyTags : [],
      shopifyProductHandle: layout?.shopifyProductHandle ?? ''
    })).filter((layout) => layout.id && layout.name);
  });
}

async function buildLayoutIndex() {
  await ensureTmpBundle();
  const mod = await import(pathToFileURL(bundledFile));
  const seedConfigs = mod.BRAND_CONFIGS ?? {};
  const storedConfigs = await readStoredBrandConfigs();
  const mergedLayouts = new Map();

  mapLayouts(seedConfigs).forEach((layout) => {
    mergedLayouts.set(layout.id, layout);
  });

  mapLayouts(storedConfigs).forEach((layout) => {
    mergedLayouts.set(layout.id, layout);
  });

  const layouts = Array.from(mergedLayouts.values());

  await fs.mkdir(publicDir, { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    layoutCount: layouts.length,
    layouts
  };
  await fs.writeFile(outputFile, JSON.stringify(payload, null, 2));
  console.log(`Layout index generated with ${layouts.length} entries.`);
}

buildLayoutIndex().catch((error) => {
  console.error('Unable to generate layout index', error);
  process.exit(1);
});
