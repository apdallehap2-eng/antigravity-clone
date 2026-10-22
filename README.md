# Antigravity Clone — تعليمات التشغيل والبناء

## التشغيل للتجربة
    npm install
    npm start

افتح ⚙ الإعدادات وأدخل مفتاح API (Gemini أو Claude أو أي خدمة متوافقة مع OpenAI).

## بناء ملف التثبيت لـ Windows 7 (32 بت)
نفّذ الأوامر على جهاز **Windows** (يفضّل ذلك على Linux/Mac لأن البناء يحتاج Wine):

    npm install --omit=optional
    npm run dist:win32

الناتج في مجلد `dist/` باسم `AntigravityClone-Setup-0.1.0-ia32.exe`.

- الإصدار **Electron 22.3.27** مثبّت عمدًا: هو آخر إصدار يعمل على Windows 7/8/8.1، ويوفّر بناء ia32.
- لا ترقِّ Electron إلى 23 أو أحدث إن أردت دعم Windows 7.

## قاعدة البيانات (Realm)
`main.js` يحاول فتح Realm أولًا، فإن تعذّر يستخدم ملف JSON تلقائيًا بنفس الواجهة (`get/set/list/del`)
ويظهر اسم القاعدة المستخدمة في شريط الحالة السفلي. `realm` مُعرَّف كاعتماد اختياري (optionalDependencies)
كي لا يفشل التثبيت إن لم تتوفر نسخته لنظامك.
لبناء نسخة 64 بت مع Realm: `npm install` ثم `npm run dist:win64` (غير مُختبَر).

## نسخة Monaco
`monaco-editor` يُثبَّت من npm ويُحمَّل محليًا. إن لم يوجد يعمل محرر بسيط بديل تلقائيًا.

## الملفات
- `main.js` العملية الرئيسية: التخزين، الملفات، الطرفية، الشبكة
- `preload.js` الجسر الآمن للواجهة
- `src/` الواجهة (HTML/CSS/JS)
- يمكن وضع قواعد المشروع في `GEMINI.md` أو `.agents/rules/*.md`، وسير العمل في `.agents/workflows/اسم.md` واستدعاؤه بـ `/اسم`.

## البناء بدون جهاز Windows حديث (GitHub Actions)
1. أنشئ مستودعًا (Repository) خاصًا على github.com وارفع محتوى هذا المجلد إليه، مع المجلد المخفي `.github`.
2. افتح تبويب **Actions** ← **build-win32** ← **Run workflow**.
3. بعد انتهاء البناء نزّل الملف من **Artifacts** (ملف zip يحتوي مثبّت الـ exe بصيغة ia32).
