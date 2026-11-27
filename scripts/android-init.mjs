#!/usr/bin/env node
/**
 * One-shot Android setup: vendor bundle -> cap add android (if missing) -> patch -> sync.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const isWindows = process.platform === 'win32';
const npx = isWindows ? 'npx.cmd' : 'npx';

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: isWindows
  });
  if (result.status !== 0) {
    process.exit(result.status === null ? 1 : result.status);
  }
}

run(process.execPath, ['scripts/sync-vendor.mjs']);

if (!fs.existsSync(path.join(root, 'android'))) {
  run(npx, ['cap', 'add', 'android']);
} else {
  console.log('[ammar-init] android/ already exists, skipping "cap add android"');
}

run(process.execPath, ['scripts/patch-android.mjs']);
run(npx, ['cap', 'sync', 'android']);
console.log('[ammar-init] Android project ready. Run "npm run android:build" or open Android Studio.');
