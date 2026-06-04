import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const rootDir = path.resolve(process.cwd());
const tmpDir = path.join(rootDir, '.cardify-cache');
const bundledFile = path.join(tmpDir, 'brand-configs.mjs');
const publicDir = path.join(rootDir, 'public');
const outputFile = path.join(publicDir, 'layout-index.json');

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

async function buildLayoutIndex() {
  await ensureTmpBundle();
  const mod = await import(pathToFileURL(bundledFile));
  const configs = mod.BRAND_CONFIGS ?? {};
  const layouts = Object.values(configs).flatMap((config) => {
    const list = Array.isArray(config?.layouts) ? config.layouts : [];
    return list.map((layout) => ({
      id: layout.id,
      name: layout.name,
      brand: layout.brand,
      shopifyTags: layout.shopifyTags ?? [],
      previewImage: layout.previewImage ?? null
    }));
  });
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
