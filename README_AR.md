# Ammar Android MVP

رفيق تفاعلي عائم لأندرويد: يظهر فوق التطبيقات الأخرى، يتجول وحده، يُسحب باللمس،
يقفز عند النقر، ويتحدث عبر فقاعة كلام، ويتواصل مع واجهته داخل WebView عبر إضافة
Capacitor أصلية.

الواجهة صفحة HTML/CSS/JS عادية داخل `www/`، ويحتضنها Capacitor 6، وتُعرض الشخصية
في نافذة عائمة عامة مبنية على
[EasyWindow 15.8](https://github.com/getActivity/EasyWindow).

---

## ما الذي أُصلح في هذه النسخة؟

| # | المشكلة في الحزمة السابقة | الأثر |
|---|---------------------------|-------|
| 1 | `patch-android.mjs` كان يبحث عن `dependencyResolutionManagement` في `android/settings.gradle`، وهو غير موجود في مشروع Capacitor 6 (المستودعات في `android/build.gradle` داخل `allprojects.repositories`). | السكربت كان يتوقف بخطأ، فلا تُركَّب الإضافة ولا الصلاحية ولا EasyWindow، ولا يمكن أن ينجح البناء. |
| 2 | الصفحة كانت تفترض وجود `window.Capacitor.Plugins.AmmarOverlay`، والجسر الأصلي يحقن `Capacitor.PluginHeaders` فقط، أما `Plugins` فينشئها `@capacitor/core` ولم تكن محمّلة. | زر التشغيل كان يخبر المستخدم دائمًا أن النافذة تحتاج نسخة أندرويد، ولا يظهر شيء. |
| 3 | لا وجود لـ `moveBy()` و`onAmmarClicked()` كدوال إضافة. | تعذّر تحريك النافذة أو إبلاغ الطبقة الأصلية بالنقر من واجهة التطبيق. |
| 4 | `showAmmar()` كان يعتبر النجاح مؤكدًا بعد `EasyWindow.show()`، وهي تُخفي أخطاء `WindowManager`. | فشل صامت على الأجهزة التي ترفض النافذة. |
| 5 | `requestOverlayPermission()` كان يُرجع النتيجة فورًا بعد `startActivity()`. | لا يمكن معرفة هل منح المستخدم الصلاحية. |
| 6 | لا تنظيف عند تدمير الـ Activity، ولا معالجة `onRenderProcessGone`، ولا حماية للملاحة داخل WebView. | تسريب نافذة/WebView وإمكانية ملاحة غير مرغوبة. |
| 7 | لا `.gitignore`، ولا التعامل مع ملف القفل، ولا رفع سجلات البناء، و`npx cap add android` يُنفَّذ دائمًا. | فشل متكرر في CI وبلا سجلات عند الخطأ. |
| 8 | `bundledWebRuntime` مهجور في `capacitor.config.json`. | تحذير في كل أمر Capacitor. |

كل ما عدا ذلك محفوظ كما وصل: رسم الشخصية SVG، التنسيقات، فقاعة الكلام،
الحركات، وملفات PWA.

---

## البنية

```
www/                          الواجهة (تستخدمها التطبيق والنافذة العائمة)
  index.html                  الشخصية والحركات وفقاعة الكلام والجسر
  manifest.webmanifest        ملف PWA
  sw.js                       Service Worker (http/https فقط)
  icons/                      الأيقونات
android-native/               مصدر الإضافة الأصلية (ينسخها سكربت الترقيع)
  AmmarEasyWindowPlugin.java  إضافة Capacitor + نافذة EasyWindow
  MainActivity.java           يسجّل الإضافة قبل إقلاع Capacitor
  AndroidManifest-permission.xml
scripts/
  patch-android.mjs           تركيب الإضافة والصلاحية وJitPack وEasyWindow
  sync-vendor.mjs             نسخ حزمة @capacitor/core إلى www/vendor
  validate-web.mjs            فحص JSON وصياغة JS وتعاقد الإضافة والبحث عن أسرار
  test-bridge.mjs             اختبارات الجسر والنقر
  android-init.mjs            add android ثم الترقيع ثم sync
  android-build.mjs           gradlew assembleDebug
backups/original/             نسخ أصلية من كل ملف تم تعديله
.github/workflows/android-debug-apk.yml
```

---

## الإعداد المحلي

المتطلبات: Node.js 20+، JDK 17، Android SDK بمنصة 34.

```bash
npm install
npm run validate
npm test
npm run android:init     # cap add android ثم الترقيع ثم sync
npm run android:build    # ينتج android/app/build/outputs/apk/debug/app-debug.apk
```

`android:init` آمن للتكرار: سكربت الترقيع لا يكرر التعديلات، ويحفظ نسخة احتياطية
من كل ملف يغيّره داخل `backups/generated/<timestamp>/`.

أو افتح Android Studio:

```bash
npm run android:open
```

---

## GitHub Actions

`.github/workflows/android-debug-apk.yml` يعمل عند كل دفعة إلى `main` أو `master`
وعند التشغيل اليدوي (`workflow_dispatch`):

1. JDK 17 (Temurin) وNode 20 وAndroid SDK (platform 34 وbuild-tools 34.0.0).
2. `npm ci` (أو `npm install` عند غياب ملف القفل).
3. `npm run validate` ثم `npm test`.
4. `npx cap add android` فقط إذا كان مجلد `android/` غير موجود.
5. `node scripts/patch-android.mjs`.
6. `npx cap sync android`.
7. `./gradlew assembleDebug --stacktrace` مع حفظ الخرج في `build.log`.
8. رفع `ammar-debug-apk` (30 يومًا) و`ammar-build-logs` (دائمًا، 14 يومًا).

ملف APK يُحمَّل من صفحة التشغيل ثم **Artifacts** ثم `ammar-debug-apk`.

---

## التثبيت والصلاحية على الهاتف

1. انسخ `app-debug.apk` إلى الهاتف وافتحه (اسمح بتثبيت التطبيقات من مصادر غير معروفة).
2. افتح تطبيق **Ammar**.
3. اضغط **إظهار Ammar فوق التطبيقات**.
4. سيفتح أندرويد صفحة *الظهور فوق التطبيقات*، فعّلها ثم ارجع.
5. تظهر الشخصية وتتجول ويمكن سحبها، وانقر عليها لتقفز وتتحدث.
   زر **إخفاء Ammar** يزيلها.

لا تعود النافذة بعد إعادة تشغيل الهاتف أو الإيقاف القسري؛ افتح التطبيق مرة أخرى.
هذه النسخة لا تستخدم خدمة أمامية دائمة، وهذا اختيار مقصود.

---

## حالة الاختبار

نُفِّذ فعلًا في بيئة العمل هذه (Debian، Temurin JDK 17.0.21، Android SDK 34):

- `npm install` — نجح.
- `npm run validate` — نجح.
- `npm test` — نجح (7 حالات: registerPlugin، وPlugins، وnativePromise، وغياب
  Capacitor، وجسر AndroidBridge، والنقر → قفزة + فقاعة + إبلاغ أصلي، ورسالة من
  الطبقة الأصلية إلى الفقاعة).
- `npx cap add android` و`node scripts/patch-android.mjs` و`npx cap sync android`
  — نجحت، وإعادة الترقيع أبلغت «nothing to do».
- `./gradlew assembleDebug` — **BUILD SUCCESSFUL** في 1m 13s.
  الملف: `android/app/build/outputs/apk/debug/app-debug.apk` بحجم 4.3 ميجابايت.
  وتأكدنا داخل الحزمة من `SYSTEM_ALERT_WINDOW` و`assets/public/index.html`
  و`assets/public/vendor/capacitor.js` ووجود أصناف
  `AmmarEasyWindowPlugin` و`EasyWindow` و`MovingWindowDraggableRule`.

لم يُختبر السلوك على هاتف حقيقي (نافذة الصلاحية، السحب، الظهور فوق تطبيق آخر)
لعدم توفر جهاز أو محاكي هنا؛ ما تم هو التحقق من البناء لا من الجهاز.

---

## حدود معروفة

- لا خدمة أمامية: تتوقف النافذة عند إنهاء العملية.
- حجم النافذة ثابت 220×280 dp، وفقاعة الكلام تُرسم داخلها.
- الحركة الذاتية مشي عشوائي بسيط كل 1.2 ثانية، لا تخطيط مسارات.
- النصوص العربية داخل الإضافة والصفحة، ولا يوجد `strings.xml` بعد.
- EasyWindow تُجلب من JitPack أثناء البناء وتحتاج إنترنت.
