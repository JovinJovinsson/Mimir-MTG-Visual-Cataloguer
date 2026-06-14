import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const assets = [
  ['src/renderer/index.html', 'dist/renderer/index.html'],
  ['src/renderer/styles.css', 'dist/renderer/styles.css'],
];

for (const [src, dst] of assets) {
  const srcPath = resolve(root, src);
  const dstPath = resolve(root, dst);
  mkdirSync(dirname(dstPath), { recursive: true });
  copyFileSync(srcPath, dstPath);
}

console.log('Assets copied.');
