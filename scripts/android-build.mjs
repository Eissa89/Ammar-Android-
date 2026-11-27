#!/usr/bin/env node
/**
 * Builds the debug APK with the Gradle wrapper of the generated Android project.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const androidDir = path.join(root, 'android');
const isWindows = process.platform === 'win32';

if (!fs.existsSync(androidDir)) {
  console.error('[ammar-build] android/ is missing. Run "npm run android:init" first.');
  process.exit(1);
}

const wrapper = path.join(androidDir, isWindows ? 'gradlew.bat' : 'gradlew');
if (!isWindows) {
  try {
    fs.chmodSync(wrapper, 0o755);
  } catch {
    // the wrapper may already be executable
  }
}

const result = spawnSync(wrapper, ['assembleDebug', '--stacktrace'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWindows
});

if (result.status !== 0) {
  process.exit(result.status === null ? 1 : result.status);
}

const apk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
console.log(`[ammar-build] ${fs.existsSync(apk) ? 'APK: ' + path.relative(root, apk) : 'APK not found'}`);
