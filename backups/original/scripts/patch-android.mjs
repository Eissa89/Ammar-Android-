import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const config = JSON.parse(await fs.readFile(path.join(root, 'capacitor.config.json'), 'utf8'));
const packageName = config.appId;
const packagePath = packageName.replaceAll('.', path.sep);
const javaDir = path.join(root, 'android', 'app', 'src', 'main', 'java', packagePath);
const settingsPath = path.join(root, 'android', 'settings.gradle');
const appGradlePath = path.join(root, 'android', 'app', 'build.gradle');
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

async function requireFile(file) {
  try { return await fs.readFile(file, 'utf8'); }
  catch { throw new Error(`الملف غير موجود: ${path.relative(root, file)}. نفّذ npx cap add android أولاً.`); }
}

let settings = await requireFile(settingsPath);
if (!settings.includes('https://jitpack.io')) {
  const reposBlock = /(dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{)([\s\S]*?)(\n\s*\})/m;
  if (reposBlock.test(settings)) {
    settings = settings.replace(reposBlock, '$1$2\n        maven { url "https://jitpack.io" }$3');
  } else {
    throw new Error('لم أجد dependencyResolutionManagement.repositories داخل android/settings.gradle؛ أضف مستودع JitPack يدويًا.');
  }
  await fs.writeFile(settingsPath, settings);
}

let appGradle = await requireFile(appGradlePath);
if (!appGradle.includes('com.github.getActivity:EasyWindow')) {
  const depsBlock = /(dependencies\s*\{)([\s\S]*?)(\n\})/m;
  if (!depsBlock.test(appGradle)) throw new Error('لم أجد كتلة dependencies داخل android/app/build.gradle.');
  appGradle = appGradle.replace(depsBlock, '$1$2\n    implementation \'com.github.getActivity:EasyWindow:15.8\'$3');
  await fs.writeFile(appGradlePath, appGradle);
}

let manifest = await requireFile(manifestPath);
if (!manifest.includes('android.permission.SYSTEM_ALERT_WINDOW')) {
  manifest = manifest.replace(/(<manifest\b[^>]*>)/, '$1\n    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />');
  await fs.writeFile(manifestPath, manifest);
}

await fs.mkdir(javaDir, { recursive: true });
await fs.copyFile(path.join(root, 'android-native', 'AmmarEasyWindowPlugin.java'), path.join(javaDir, 'AmmarEasyWindowPlugin.java'));
await fs.copyFile(path.join(root, 'android-native', 'MainActivity.java'), path.join(javaDir, 'MainActivity.java'));
console.log('تم تركيب Native Plugin وصلاحية الظهور ومستودع JitPack وEasyWindow 15.8.');
