#!/usr/bin/env node
/**
 * Wires the Ammar overlay plugin into a Capacitor-generated Android project.
 *
 * Runs after `npx cap add android` and before `npx cap sync android`.
 * Every touched file is backed up under backups/generated/<timestamp>/ first,
 * and the script is idempotent: running it twice changes nothing.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const EASYWINDOW_VERSION = '15.8';
const EASYWINDOW_COORDINATE = `com.github.getActivity:EasyWindow:${EASYWINDOW_VERSION}`;
const JITPACK_URL = 'https://jitpack.io';
const OVERLAY_PERMISSION = 'android.permission.SYSTEM_ALERT_WINDOW';

const root = process.cwd();
const configPath = path.join(root, 'capacitor.config.json');
const androidDir = path.join(root, 'android');
const buildGradlePath = path.join(androidDir, 'build.gradle');
const settingsGradlePath = path.join(androidDir, 'settings.gradle');
const appGradlePath = path.join(androidDir, 'app', 'build.gradle');
const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
const nativeSourceDir = path.join(root, 'android-native');

const changes = [];
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = path.join(root, 'backups', 'generated', timestamp);

function log(message) {
  console.log(`[ammar-patch] ${message}`);
}

async function readText(file, hint) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    throw new Error(
      hint || `Missing file: ${path.relative(root, file)}. Run "npx cap add android" first.`
    );
  }
}

async function backup(file) {
  const relative = path.relative(root, file);
  const target = path.join(backupRoot, relative);
  try {
    await fs.access(target);
    return;
  } catch {
    // first backup for this file
  }
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(file, target);
  } catch {
    // file does not exist yet, nothing to back up
  }
}

async function writeText(file, content, reason) {
  await backup(file);
  await fs.writeFile(file, content, 'utf8');
  changes.push(`${path.relative(root, file)} — ${reason}`);
}

async function readConfig() {
  const raw = await readText(configPath, 'capacitor.config.json is missing.');
  const config = JSON.parse(raw);
  if (!config.appId) {
    throw new Error('capacitor.config.json has no "appId"; cannot locate the Java package.');
  }
  return config;
}

/** Gradle 7+ projects may declare repositories in settings.gradle; Capacitor 6 does not. */
async function addJitPackRepository() {
  const settings = await readText(settingsGradlePath, 'android/settings.gradle is missing.');
  if (settings.includes(JITPACK_URL)) {
    log('JitPack already configured in settings.gradle');
    return;
  }

  if (/dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{/.test(settings)) {
    const updated = settings.replace(
      /(dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{)/,
      `$1\n        maven { url '${JITPACK_URL}' }`
    );
    await writeText(settingsGradlePath, updated, 'JitPack repository (settings.gradle)');
    return;
  }

  let gradle = await readText(buildGradlePath, 'android/build.gradle is missing.');
  if (gradle.includes(JITPACK_URL)) {
    log('JitPack already configured in build.gradle');
    return;
  }

  const anchor = gradle.match(/allprojects\s*\{[\s\S]*?repositories\s*\{/);
  if (anchor) {
    const insertAt = anchor.index + anchor[0].length;
    gradle =
      gradle.slice(0, insertAt) +
      `\n        maven { url '${JITPACK_URL}' }` +
      gradle.slice(insertAt);
    await writeText(buildGradlePath, gradle, 'JitPack repository (allprojects.repositories)');
    return;
  }

  gradle +=
    `\n\nallprojects {\n    repositories {\n` +
    `        maven { url '${JITPACK_URL}' }\n    }\n}\n`;
  await writeText(buildGradlePath, gradle, 'JitPack repository (appended allprojects block)');
}

async function addEasyWindowDependency() {
  let gradle = await readText(appGradlePath, 'android/app/build.gradle is missing.');
  if (gradle.includes('com.github.getActivity:EasyWindow')) {
    log('EasyWindow dependency already present');
    return;
  }

  const block = gradle.match(/^dependencies\s*\{([\s\S]*?)^\}/m);
  if (!block) {
    throw new Error('No top-level dependencies block found in android/app/build.gradle.');
  }

  const body = block[1].replace(/\s*$/, '\n');
  const updated =
    gradle.slice(0, block.index) +
    `dependencies {${body}    implementation '${EASYWINDOW_COORDINATE}'\n}` +
    gradle.slice(block.index + block[0].length);
  await writeText(appGradlePath, updated, `EasyWindow ${EASYWINDOW_VERSION} dependency`);
}

async function addOverlayPermission() {
  let manifest = await readText(manifestPath, 'AndroidManifest.xml is missing.');
  if (manifest.includes(OVERLAY_PERMISSION)) {
    log('SYSTEM_ALERT_WINDOW already declared');
    return;
  }

  const manifestTag = manifest.match(/<manifest\b[^>]*>/);
  if (!manifestTag) {
    throw new Error('AndroidManifest.xml has no <manifest> root element.');
  }

  const insertAt = manifestTag.index + manifestTag[0].length;
  const permission = `\n\n    <!-- Allows Ammar to float above other apps (granted by the user at runtime). -->` +
    `\n    <uses-permission android:name="${OVERLAY_PERMISSION}" />`;
  manifest = manifest.slice(0, insertAt) + permission + manifest.slice(insertAt);
  await writeText(manifestPath, manifest, 'SYSTEM_ALERT_WINDOW permission');
}

async function copyPluginSource(packageName) {
  const javaDir = path.join(androidDir, 'app', 'src', 'main', 'java', ...packageName.split('.'));
  await fs.mkdir(javaDir, { recursive: true });

  const pluginTarget = path.join(javaDir, 'AmmarEasyWindowPlugin.java');
  const pluginSource = await readText(path.join(nativeSourceDir, 'AmmarEasyWindowPlugin.java'));
  const pluginCurrent = await fs.readFile(pluginTarget, 'utf8').catch(() => null);
  if (pluginCurrent !== pluginSource) {
    await writeText(pluginTarget, pluginSource, 'AmmarEasyWindowPlugin.java installed');
  } else {
    log('AmmarEasyWindowPlugin.java already up to date');
  }
}

async function installMainActivity(packageName) {
  const javaDir = path.join(androidDir, 'app', 'src', 'main', 'java', ...packageName.split('.'));
  const target = path.join(javaDir, 'MainActivity.java');
  const template = await readText(path.join(nativeSourceDir, 'MainActivity.java'));
  const current = await fs.readFile(target, 'utf8').catch(() => null);

  if (current && current.includes('AmmarEasyWindowPlugin')) {
    log('MainActivity already registers AmmarEasyWindowPlugin');
    return;
  }

  const isTrivialTemplate =
    current === null || /class\s+MainActivity\s+extends\s+BridgeActivity\s*\{\s*\}/.test(current);
  if (isTrivialTemplate) {
    await writeText(target, template, 'MainActivity registers AmmarEasyWindowPlugin');
    return;
  }

  // Keep existing custom code: insert the registration as the first onCreate statement.
  let patched = current;
  if (/super\.onCreate\s*\(/.test(patched)) {
    patched = patched.replace(
      /(\n\s*)(super\.onCreate\s*\()/,
      '$1registerPlugin(AmmarEasyWindowPlugin.class);$1$2'
    );
  } else if (/void\s+onCreate\s*\([^)]*\)\s*\{/.test(patched)) {
    patched = patched.replace(
      /(void\s+onCreate\s*\([^)]*\)\s*\{)/,
      '$1\n        registerPlugin(AmmarEasyWindowPlugin.class);'
    );
  } else {
    patched = patched.replace(
      /\}\s*$/,
      '\n\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n' +
        '        registerPlugin(AmmarEasyWindowPlugin.class);\n' +
        '        super.onCreate(savedInstanceState);\n    }\n}\n'
    );
  }

  if (!patched.includes('AmmarEasyWindowPlugin')) {
    throw new Error('Could not add registerPlugin() to MainActivity.java; add it manually.');
  }
  await writeText(target, patched, 'MainActivity registers AmmarEasyWindowPlugin');
}

async function main() {
  const config = await readConfig();
  const packageName = config.appId;

  try {
    await fs.access(androidDir);
  } catch {
    throw new Error('android/ does not exist. Run "npx cap add android" before patching.');
  }

  await addJitPackRepository();
  await addEasyWindowDependency();
  await addOverlayPermission();
  await copyPluginSource(packageName);
  await installMainActivity(packageName);

  const webAssets = path.join(androidDir, 'app', 'src', 'main', 'assets', 'public', 'index.html');
  try {
    await fs.access(webAssets);
  } catch {
    log('warning: assets/public/index.html not found yet — run "npx cap sync android" next.');
  }

  if (changes.length === 0) {
    log('nothing to do — Android project already patched');
  } else {
    for (const change of changes) {
      log(`updated ${change}`);
    }
    log(`backups: ${path.relative(root, backupRoot)}`);
  }
  log(`EasyWindow ${EASYWINDOW_VERSION} + ${OVERLAY_PERMISSION} ready for package ${packageName}`);
}

main().catch((error) => {
  console.error(`[ammar-patch] ${error.message}`);
  process.exitCode = 1;
});
