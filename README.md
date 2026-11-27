# Ammar — Android Floating Companion (Capacitor + EasyWindow)

Ammar is an interactive floating companion for Android. It appears above other
apps, walks around the screen on its own, can be dragged, jumps when tapped,
speaks through a speech bubble, and talks to its WebView interface through a
Capacitor plugin.

The web UI is a plain HTML/CSS/JS page in `www/`. Capacitor wraps it in an
Android application, and a native plugin (`AmmarEasyWindowPlugin`) hosts the
companion in a global overlay window built with
[EasyWindow 15.8](https://github.com/getActivity/EasyWindow).

---

## 1. Project layout

```
.
├── www/                                 web UI (shared by the app and the overlay)
│   ├── index.html                       character, animations, speech bubble, bridge
│   ├── manifest.webmanifest             PWA manifest
│   ├── sw.js                            service worker (http/https only)
│   └── icons/                           app icons
├── android-native/                      source of the native plugin (copied in by the patch script)
│   ├── AmmarEasyWindowPlugin.java       Capacitor plugin + EasyWindow overlay
│   ├── MainActivity.java                registers the plugin before Capacitor boots
│   └── AndroidManifest-permission.xml   the permission line, for reference
├── scripts/
│   ├── patch-android.mjs                injects plugin, permission, JitPack, EasyWindow
│   ├── sync-vendor.mjs                  copies @capacitor/core browser bundle to www/vendor
│   ├── validate-web.mjs                 static checks (JSON, JS syntax, plugin contract, secrets)
│   ├── android-init.mjs                 add android -> patch -> sync
│   └── android-build.mjs                gradlew assembleDebug
├── backups/original/                    untouched copies of every file that was modified
├── .github/workflows/android-debug-apk.yml
├── capacitor.config.json
└── package.json
```

---

## 2. Audit: what was broken in the delivered package

The archive contained a good start, but it could not build and could not launch
the overlay. The blocking issues were:

| # | Problem | Impact |
|---|---------|--------|
| 1 | `patch-android.mjs` looked for `dependencyResolutionManagement` in `android/settings.gradle`. Capacitor 6 does not generate that block — repositories live in `android/build.gradle` under `allprojects.repositories`. | The script threw an error, so no plugin, no permission, no EasyWindow. The build could never succeed. |
| 2 | The page assumed `window.Capacitor.Plugins.AmmarOverlay`. The native bridge only injects `Capacitor.PluginHeaders`; `Plugins` is created by `@capacitor/core`, and the page loaded no core bundle. | The overlay never launched from the app UI; it always reported "requires the Android version". |
| 3 | No `moveBy()` / `onAmmarClicked()` plugin methods, although the interface required them. | The main WebView could not move the window or notify taps. |
| 4 | `showAmmar()` resolved success right after `EasyWindow.show()`. EasyWindow swallows `WindowManager` exceptions, so failures looked like successes. | Silent failures on devices that reject the window. |
| 5 | `requestOverlayPermission()` resolved immediately after `startActivity()`. | The caller could not tell whether the user granted the permission. |
| 6 | No cleanup on activity destroy, no `onRenderProcessGone` handling, no navigation guard on the overlay WebView. | Window/WebView leaks, and the overlay could navigate anywhere. |
| 7 | No `.gitignore`, no lockfile handling, no build-log artifact, and `npx cap add android` ran unconditionally in CI. | CI failed on re-runs and left no logs when the build broke. |
| 8 | Deprecated `bundledWebRuntime` in `capacitor.config.json`. | Build warning on every Capacitor command. |

Everything else — the character SVG, the CSS, the speech bubble, the animations,
the PWA files — is preserved as delivered.

---

## 3. Native overlay design

* **Permission** — `SYSTEM_ALERT_WINDOW` is declared in the manifest (a manifest
  entry alone grants nothing). `checkOverlayPermission()` reads
  `Settings.canDrawOverlays()`; `requestOverlayPermission()` opens
  `ACTION_MANAGE_OVERLAY_PERMISSION` through Capacitor's
  `startActivityForResult()` and resolves with the real result after the user
  returns.
* **Window** — `EasyWindow.with(Application)` (global window, requires the
  permission), `setWindowSize(220dp, 280dp)` to match the CSS stage,
  `setWindowLocation(Gravity.TOP | Gravity.LEFT, x, y)`, and
  `setWindowDraggableRule(new MovingWindowDraggableRule())` for finger dragging.
* **Transparent WebView** — `Color.TRANSPARENT` background, hardware layer, no
  scrollbars, `file:///android_asset/public/index.html?mode=android` (the asset
  directory Capacitor copies `www/` into).
* **Movement** — `moveBy(dx, dy)` clamps every step to ±240 dp, converts dp to
  pixels, and clamps the result to the screen using
  `WindowManager.getMaximumWindowMetrics()` on API 30+ and `getRealMetrics()`
  below it. Dragging and autonomous movement share the same
  `WindowManager.LayoutParams`, so they never fight.
* **Lifecycle** — the window is recycled (`cancel()` + `recycle()`) and the
  WebView destroyed (`removeJavascriptInterface()` then `destroy()`) on hide, on
  `handleOnDestroy()`, and when the render process dies.
* **JS bridge** — only two methods are exposed to the overlay page
  (`AndroidBridge.moveBy`, `AndroidBridge.onAmmarClicked`), with numeric
  validation. Navigation away from `file:///android_asset/` is blocked.

### JavaScript interface

| Method | Transport | Notes |
|--------|-----------|-------|
| `showAmmar({ text })` | Capacitor plugin | rejects when the permission is missing |
| `hideAmmar()` | Capacitor plugin | resolves `{ showing: false }` |
| `moveBy(dx, dy)` | plugin **or** `AndroidBridge` | ±240 dp clamp, screen-bounded |
| `onAmmarClicked()` | plugin **or** `AndroidBridge` | makes the overlay jump, fires `ammarClicked` |
| `checkOverlayPermission()` | plugin | `{ granted, sdkInt }` |
| `requestOverlayPermission()` | plugin | resolves after the settings screen returns |

The web side resolves the plugin in three steps so it works in every
configuration: `Capacitor.registerPlugin()` (official API, provided by
`www/vendor/capacitor.js`) → `Capacitor.Plugins` → `Capacitor.nativePromise`
(the transport `registerPlugin` itself uses).

---

## 4. Local build

Requirements: Node.js 20+, JDK 17, Android SDK with platform 34.

```bash
npm install
npm run validate          # JSON, JS syntax, plugin contract, secret scan
npm test                  # web bridge + tap behaviour tests
npm run android:init      # cap add android -> patch -> sync
npm run android:build     # android/app/build/outputs/apk/debug/app-debug.apk
```

`android:init` is safe to re-run: the patch script is idempotent and backs up
every file it changes under `backups/generated/<timestamp>/`.

To build with Android Studio instead:

```bash
npm run android:open
```

The debug APK is signed with the debug key, so it installs on any device with
"install unknown apps" enabled.

---

## 5. GitHub Actions

`.github/workflows/android-debug-apk.yml` runs on every push to `main`/`master`
and on demand (`workflow_dispatch`):

1. JDK 17 (Temurin) + Node 20 + Android SDK (platform 34, build-tools 34.0.0).
2. `npm ci` (falls back to `npm install` when there is no lockfile).
3. `npm run validate` — JSON, JS syntax, plugin contract, secret scan.
4. `npm test` — bridge transport and tap-behaviour tests.
5. `npx cap add android` only when `android/` is absent.
6. `node scripts/patch-android.mjs` — JitPack repository, EasyWindow 15.8,
   `SYSTEM_ALERT_WINDOW`, plugin sources, `MainActivity` registration.
7. `npx cap sync android`.
8. `./gradlew assembleDebug --stacktrace` with the output teed to `build.log`.
9. Uploads `ammar-debug-apk` (30 days) and `ammar-build-logs` (always, 14 days).

Download the APK from the run page → **Artifacts** → `ammar-debug-apk`.

---

## 6. Install and permission on a device

1. Copy `app-debug.apk` to the phone and open it (allow "install unknown apps").
2. Open **Ammar**.
3. Tap **إظهار Ammar فوق التطبيقات** (show Ammar above apps).
4. Android opens *Display over other apps* for Ammar — enable it and press back.
5. The companion appears, walks, and can be dragged. Tap it to make it jump and
   speak. Use **إخفاء Ammar** (hide) to remove it.

The overlay does not survive a device reboot or a force-stop. Reopen the app to
bring it back. This MVP runs no foreground service — that is deliberate.

---

## 7. Verification status

Executed in this workspace (Debian, Temurin JDK 17.0.21, Android SDK 34):

* `npm install` — passed.
* `npm run validate` — passed (JSON, JS syntax, plugin contract, secret scan).
* `npm test` — passed: 7 bridge scenarios (registerPlugin, Plugins fallback,
  nativePromise fallback, no-Capacitor degradation, AndroidBridge overlay,
  tap -> jump + bubble + native callback, native -> bubble speech).
* `npx cap add android`, `node scripts/patch-android.mjs`,
  `npx cap sync android` — passed, and re-running the patch reported
  "nothing to do" (idempotent).
* `./gradlew assembleDebug` — **BUILD SUCCESSFUL in 1m 13s**, 82 tasks.
  APK: `android/app/build/outputs/apk/debug/app-debug.apk` (4.3 MB,
  sha256 `2de1301e94ce8fe790d3963b33f8284ea714054e8f5849f9c0b94b69b74acfc0`).
  Verified inside the APK: `SYSTEM_ALERT_WINDOW`, `assets/public/index.html`,
  `assets/public/vendor/capacitor.js`, and the
  `AmmarEasyWindowPlugin` / `EasyWindow` / `MovingWindowDraggableRule` classes.
* Real-device behaviour (permission dialog, dragging, overlay above other apps)
  **was not** exercised: no Android hardware or emulator was available here.
  That is build verification, not device verification.

---

## 8. Limitations

* No foreground service: the overlay stops when the process is killed.
* The overlay window is a fixed 220×280 dp box; the speech bubble is drawn
  inside it.
* Autonomous movement is a simple random walk (1.2 s ticks), not pathfinding.
* Arabic strings live in the plugin and the page; there is no `strings.xml` yet.
* EasyWindow is fetched from JitPack at build time (needs network).
