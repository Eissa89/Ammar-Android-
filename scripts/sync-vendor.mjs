#!/usr/bin/env node
/**
 * Copies the official @capacitor/core browser bundle into www/vendor so the
 * plain-HTML page can call Capacitor.registerPlugin() without a bundler.
 *
 * The page also has a fallback (Capacitor.nativePromise), so a missing copy is
 * a warning, not a failure.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'node_modules', '@capacitor', 'core', 'dist', 'capacitor.js');
const targetDir = path.join(root, 'www', 'vendor');
const target = path.join(targetDir, 'capacitor.js');

async function main() {
  try {
    const bundle = await fs.readFile(source, 'utf8');
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(target, bundle, 'utf8');
    console.log(`[ammar-vendor] ${path.relative(root, source)} -> ${path.relative(root, target)} (${bundle.length} bytes)`);
  } catch (error) {
    console.warn(`[ammar-vendor] skipped: ${error.message}`);
    console.warn('[ammar-vendor] run "npm install" first; the page falls back to Capacitor.nativePromise.');
  }
}

main();
