#!/usr/bin/env node
/**
 * Static validation for the Ammar project.
 *
 * Checks JSON files, JavaScript syntax (including inline <script> blocks),
 * required web assets, the native plugin contract, and obvious secret leaks.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const failures = [];
const warnings = [];

const REQUIRED_FILES = [
  'package.json',
  'capacitor.config.json',
  'www/index.html',
  'www/manifest.webmanifest',
  'www/sw.js',
  'www/icons/icon-192.png',
  'www/icons/icon-512.png',
  'android-native/AmmarEasyWindowPlugin.java',
  'android-native/AmmarDragHandleRule.java',
  'android-native/MainActivity.java',
  'scripts/patch-android.mjs',
  'scripts/test-bridge.mjs',
  '.github/workflows/android-debug-apk.yml'
];

const PLUGIN_METHODS = [
  'checkOverlayPermission',
  'requestOverlayPermission',
  'showAmmar',
  'hideAmmar',
  'moveBy',
  'onAmmarClicked'
];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

async function checkJson(relativePath) {
  try {
    const raw = await fs.readFile(path.join(root, relativePath), 'utf8');
    JSON.parse(raw);
    console.log(`json ok      ${relativePath}`);
  } catch (error) {
    fail(`${relativePath}: ${error.message}`);
  }
}

function checkScript(source, filename) {
  try {
    new vm.Script(source, { filename });
    console.log(`script ok    ${filename}`);
  } catch (error) {
    fail(`${filename}: ${error.message}`);
  }
}

function checkModuleFile(relativePath) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, relativePath)], {
    encoding: 'utf8'
  });
  if (result.status === 0) {
    console.log(`module ok    ${relativePath}`);
  } else {
    fail(`${relativePath}: ${(result.stderr || '').trim().split('\n').slice(0, 3).join(' ')}`);
  }
}

async function checkInlineScripts(relativePath) {
  const html = await fs.readFile(path.join(root, relativePath), 'utf8');
  const pattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let index = 0;
  while ((match = pattern.exec(html)) !== null) {
    index += 1;
    checkScript(match[1], `${relativePath}#inline-${index}`);
  }
  if (index === 0) {
    warn(`${relativePath}: no inline scripts found`);
  }
}

async function checkFiles() {
  for (const relativePath of REQUIRED_FILES) {
    try {
      const stats = await fs.stat(path.join(root, relativePath));
      if (stats.size === 0) {
        fail(`${relativePath}: file is empty`);
      }
    } catch {
      fail(`${relativePath}: missing`);
    }
  }
  console.log(`files        ${REQUIRED_FILES.length} required paths checked`);
}

async function checkPluginContract() {
  const java = await fs.readFile(
    path.join(root, 'android-native', 'AmmarEasyWindowPlugin.java'),
    'utf8'
  );
  const declared = [...java.matchAll(/@PluginMethod\s+public\s+void\s+(\w+)\s*\(/g)].map((m) => m[1]);
  for (const method of PLUGIN_METHODS) {
    if (!declared.includes(method)) {
      fail(`AmmarEasyWindowPlugin.java: missing @PluginMethod ${method}()`);
    }
  }
  if (!java.includes('@CapacitorPlugin(name = "AmmarOverlay")')) {
    fail('AmmarEasyWindowPlugin.java: plugin name must stay "AmmarOverlay"');
  }
  if (!java.includes('EasyWindow.with(')) {
    fail('AmmarEasyWindowPlugin.java: EasyWindow is never created');
  }
  if (!java.includes('new AmmarDragHandleRule()')) {
    fail('AmmarEasyWindowPlugin.java: drag-handle rule is not installed');
  }
  const dragRule = await fs.readFile(
    path.join(root, 'android-native', 'AmmarDragHandleRule.java'),
    'utf8'
  );
  if (!dragRule.includes('DRAG_HANDLE_HEIGHT_DP')) {
    fail('AmmarDragHandleRule.java: drag handle boundary is missing');
  }
  console.log(`plugin       methods: ${declared.join(', ')}`);

  const html = await fs.readFile(path.join(root, 'www', 'index.html'), 'utf8');
  if (!html.includes("'AmmarOverlay'")) {
    fail('www/index.html: does not reference the AmmarOverlay plugin');
  }
  if (!html.includes('id="drag-handle"')) {
    fail('www/index.html: native drag handle indicator is missing');
  }
  if (!html.includes('mode=android') && !html.includes("'android'")) {
    fail('www/index.html: overlay mode query parameter is not handled');
  }
  if (!html.includes('registerPlugin')) {
    warn('www/index.html: Capacitor.registerPlugin() is not used');
  }
  console.log('contract     web <-> native names checked');
}

async function checkSecrets() {
  const targets = [
    'www/index.html',
    'www/sw.js',
    'scripts/patch-android.mjs',
    'scripts/sync-vendor.mjs',
    'android-native/AmmarEasyWindowPlugin.java',
    'android-native/MainActivity.java',
    '.github/workflows/android-debug-apk.yml'
  ];
  const patterns = [
    { name: 'OpenAI-style key', regex: /\bsk-[A-Za-z0-9]{20,}\b/ },
    { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
    { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
    { name: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
    { name: 'private key block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ }
  ];

  for (const relativePath of targets) {
    let content;
    try {
      content = await fs.readFile(path.join(root, relativePath), 'utf8');
    } catch {
      continue;
    }
    for (const pattern of patterns) {
      if (pattern.regex.test(content)) {
        fail(`${relativePath}: possible ${pattern.name} committed in source`);
      }
    }
  }
  console.log('secrets      pattern scan complete');
}

async function checkWorkflow() {
  const workflow = await fs.readFile(
    path.join(root, '.github', 'workflows', 'android-debug-apk.yml'),
    'utf8'
  );
  const required = [
    'workflow_dispatch',
    'assembleDebug',
    'actions/upload-artifact',
    'setup-java',
    'setup-node',
    'cap add android',
    'patch-android.mjs',
    'cap sync android'
  ];
  for (const token of required) {
    if (!workflow.includes(token)) {
      fail(`android-debug-apk.yml: missing "${token}"`);
    }
  }
  console.log('workflow     required steps checked');
}

async function main() {
  await checkFiles();
  await checkJson('package.json');
  await checkJson('capacitor.config.json');
  await checkJson('www/manifest.webmanifest');

  await checkInlineScripts('www/index.html');
  checkScript(await fs.readFile(path.join(root, 'www', 'sw.js'), 'utf8'), 'www/sw.js');
  for (const modulePath of [
    'scripts/patch-android.mjs',
    'scripts/sync-vendor.mjs',
    'scripts/android-init.mjs',
    'scripts/android-build.mjs',
    'scripts/validate-web.mjs',
    'scripts/test-bridge.mjs'
  ]) {
    checkModuleFile(modulePath);
  }

  await checkPluginContract();
  await checkSecrets();
  await checkWorkflow();

  for (const warning of warnings) {
    console.warn(`warn: ${warning}`);
  }
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`fail: ${failure}`);
    }
    console.error(`\n${failures.length} check(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nall checks passed (${warnings.length} warning(s))`);
}

main().catch((error) => {
  console.error(`[ammar-validate] ${error.stack || error.message}`);
  process.exitCode = 1;
});
