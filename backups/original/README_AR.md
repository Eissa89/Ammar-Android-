# Ammar Android MVP

هذه حزمة مستقلة مبنية على ملف `Ammar Interactive Companion.html` المرفق. لم يتم تعديل مشروع `Kimbo-v0.1` أو دمجه هنا.

## ما الذي أصبح موجودًا؟

- واجهة Ammar الأصلية مع الحركة والتحدث والقفز.
- PWA بسيط مع `manifest.webmanifest` وService Worker.
- Capacitor 6 لإنتاج تطبيق Android.
- Native Plugin باسم `AmmarOverlay`.
- نافذة عائمة عامة باستخدام EasyWindow 15.8، قابلة للسحب.
- حركة النافذة من JavaScript عبر `AndroidBridge.moveBy()`.
- فحص صلاحية الظهور فوق التطبيقات وفتح صفحة إعداداتها عند عدم منحها.
- تشغيل تلقائي للنافذة عند فتح التطبيق **فقط إذا كانت الصلاحية ممنوحة مسبقًا**.
- إخفاء الشخصية من زر داخل التطبيق.
- Workflow اختياري لبناء APK Debug عبر GitHub Actions.

## المتطلبات

- Node.js 20 أو أحدث.
- JDK 17.
- Android SDK / Android Studio لبناء محلي، أو استخدام GitHub Actions الموجود في `.github/workflows/android-debug-apk.yml`.

## الإعداد السريع

من داخل مجلد `Ammar-Android-MVP`:

```bash
npm install
npm run android:init
npm run android:sync
```

`android:init` ينشئ مشروع Android بواسطة Capacitor، ثم يشغّل `scripts/patch-android.mjs` لإضافة:

- JitPack داخل `dependencyResolutionManagement.repositories` في `android/settings.gradle`.
- `implementation 'com.github.getActivity:EasyWindow:15.8'` في `android/app/build.gradle`.
- صلاحية `SYSTEM_ALERT_WINDOW` في `AndroidManifest.xml`.
- `AmmarEasyWindowPlugin.java` و`MainActivity.java` داخل مسار الحزمة الصحيح.

بعدها:

```bash
npm run android:open
```

ومن Android Studio اختر بناء APK Debug.

## بناء APK من سطر الأوامر

بعد تثبيت Android SDK وضبط `ANDROID_HOME`:

```bash
cd android
./gradlew assembleDebug
```

في Windows:

```powershell
cd android
.\gradlew.bat assembleDebug
```

المسار المعتاد للملف الناتج:

`android/app/build/outputs/apk/debug/app-debug.apk`

## إذن الظهور فوق التطبيقات

وجود السطر في Manifest **لا يمنح الإذن تلقائيًا**. على Android يجب أن يوافق المستخدم من إعدادات النظام. عند ضغط زر التشغيل لأول مرة، يفتح التطبيق صفحة صلاحية الظهور فوق التطبيقات؛ فعّلها ثم ارجع واضغط زر التشغيل مرة أخرى. بعد منحها، يحاول التطبيق إظهار Ammar تلقائيًا عند فتحه.

## نقاط تقنية مهمة

1. استُخدم EasyWindow `15.8` وفق README الرسمي الحالي للمكتبة، بدل `10.6` الوارد في المسودة القديمة.
2. استُخدم Java في الإضافة الأصلية لتجنب إضافة Kotlin Gradle Plugin إلى مشروع Capacitor الافتراضي. الوظائف هي نفسها.
3. الإضافة تنشئ WebView صغيرة مستقلة من ملفات التطبيق المحلية `file:///android_asset/public/index.html?mode=android`؛ لا تعتمد على عنوان localhost داخل نافذة خارجية.
4. `MovingWindowDraggableRule` يعالج السحب اليدوي، و`AndroidBridge.moveBy` يحدّث موضع النافذة للحركة الذاتية.
5. لا يوجد تشغيل خفي بعد إعادة تشغيل الهاتف، ولا خدمة Foreground مستمرة في هذا الـMVP. يجب فتح التطبيق مرة واحدة بعد تشغيل الجهاز. إضافة خدمة مستمرة موضوع منفصل يحتاج إشعارًا دائمًا وسلوكًا واضحًا للمستخدم.

## حدود الاختبار

تم تجهيز الملفات وفحص بنية الحزمة وصياغة JavaScript وJSON. لم يتم بناء APK فعليًا في بيئة هذه الجلسة لعدم توفر Android SDK وGradle Android toolchain هنا؛ لذلك يلزم تنفيذ البناء على جهاز مجهز أو عبر GitHub Actions، ثم اختبار الإذن والسحب على هاتف حقيقي.
