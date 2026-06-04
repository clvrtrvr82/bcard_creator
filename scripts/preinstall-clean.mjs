import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '..');
const nodeModulesDir = path.join(projectRoot, 'node_modules');

if (!fs.existsSync(nodeModulesDir)) {
  console.log('[clean:modules] node_modules does not exist. Nothing to remove.');
  process.exit(0);
}

try {
  fs.rmSync(nodeModulesDir, { recursive: true, force: true });
  console.log(`[clean:modules] Removed ${nodeModulesDir}. Re-run "npm install" to rebuild dependencies.`);
} catch (error) {
  console.error('[clean:modules] Failed to remove node_modules:', error.message);
  process.exit(1);
}
