import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '..');
const distDir = path.join(projectRoot, 'dist');
const distIndex = path.join(distDir, 'index.html');

const hasBundledIndex =
  fs.existsSync(distIndex) &&
  !fs.readFileSync(distIndex, 'utf8').includes('index.tsx');

if (hasBundledIndex) {
  console.log('[ensure-build] Existing dist bundle looks good. Skipping rebuild.');
  process.exit(0);
}

try {
  console.log('[ensure-build] Missing or unbundled dist detected. Running "npm run build"...');
  execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
  console.log('[ensure-build] Build completed.');
} catch (error) {
  console.error('[ensure-build] Build failed:', error.message);
  process.exit(1);
}
