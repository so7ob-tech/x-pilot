# X-Pilot

<p align="center">
  <img src="public/branding/x-pilot-logo.png" alt="X-Pilot logo" width="180" />
</p>

<p align="center"><strong>إدارة محلية وموثوقة لقائمة نشر X</strong></p>

إضافة Chrome باسم **X-Pilot** مبنية على Manifest V3 وTypeScript وReact لإدارة قائمة محلية من روابط تجهيز منشورات X/Twitter، مع جدولة واستمرارية وسجل محلي.

> **تنبيه مهم:** تستخدم هذه النسخة تفاعلًا محدودًا مع واجهة X عبر Content Script. قد تتغير واجهة X، وقد تقيد سياسات X أو تمنع أتمتة الموقع. لا تتضمن الإضافة أي تجاوز لتسجيل الدخول أو CAPTCHA أو حدود المعدل أو أنظمة مكافحة الروبوتات. عند اكتشاف Login أو تحدٍ أمني تتوقف العملية.

## الحالة الحالية

هذا أول Scaffold قابل للبناء، ويشمل:

- Manifest V3 وService Worker.
- React Side Panel بواجهة عربية RTL.
- استخراج روابط X/Twitter وإزالة التكرار.
- Queue محلية مع إعادة ترتيب وحذف وإعادة محاولة ومسح المكتمل.
- تخزين `chrome.storage.local`.
- جدولة `chrome.alarms`.
- علامة أتمتة واحدة قابلة لإعادة الاستخدام.
- `XProviderAdapter` مع تحقق قبل النشر.
- Lock منطقي عبر `operationId` ومنع النشر إذا لم يثبت وجود المحرر والمحتوى وزر النشر.
- سجل Attempts أولي.
- Dry Run / Test Mode لفحص Composer والمحتوى وزر Post دون النشر، مع اختبار عنصر واحد أو Queue كاملة بالتتابع.
- Full Backup / Restore محلي بصيغة JSON لجميع Workspaces والبنوك وQueue والسجل والإعدادات، مع تحقق قبل الاستعادة.
- Scheduled Sessions وPublishing Windows حسب أيام الأسبوع والمنطقة الزمنية، مع Workspace Profiles وإشعارات مهمة وChrome Badge.
- نتائج Dry Run تعرض رقم العنصر وأول 10 كلمات فقط دون الروابط الطويلة، والجدولة تنشئ جلسة قابلة للتنفيذ حتى عند عدم وجود Session سابقة.
- تبويب مستقل باسم اختبارات البدء يحتوي على PREFLIGHT CHECK وDRY RUN · NO POST.
- Advanced Search & Filters داخل Queue وTweet Banks وSessions وHistory حسب النص والحالة والبنك والجلسة والتاريخ وWorkspace.
- Bulk Queue Actions لتحديد عدة عناصر وتنفيذ Delete وSkip وRetry وReset to Pending والتحريك والتعيين والتصدير، مع حماية العنصر الجاري.
- Analytics Dashboard لعرض مؤشرات كل Workspace ومؤشرات X-Pilot العامة مشتقة مباشرة من Sessions وHistory دون تخزين مكرر.
- Diagnostics Center لفحص الإصدار والتخزين والـAlarm والتبويب وX Login وComposer وPost Button والصلاحيات باستخدام فحص قراءة فقط دون نشر.
- Data Architecture v4 تفصل Runtime التشغيلي عن Session Records وPublish Attempts والإعدادات، مع Migration آمن من schema v3 وBackup format v2.

## التطوير

```bash
npm install
npm run build
```

ينتج البناء مجلد `dist/`.

## Load Unpacked

1. افتح `chrome://extensions`.
2. فعّل **Developer mode**.
3. اضغط **Load unpacked**.
4. اختر مجلد `dist/`.
5. افتح Side Panel من أي صفحة، ثم أدخل رابط بنك التغريدات.

بعد تعديل الكود شغّل `npm run build` واضغط **Reload** للإضافة من صفحة الإضافات.

## الهوية البصرية

تستخدم الإضافة شعار X-Pilot الشفاف الرسمي في أيقونات Chrome، ورأس Side Panel، وبطاقتي Settings وRecovery. توجد النسخ المناسبة لمقاسات المتصفح داخل `public/icons/`، بينما توجد النسخة الرئيسية عالية الدقة داخل `public/branding/`.

## الصلاحيات

- `storage`: حفظ Queue والإعدادات والسجل محليًا.
- `alarms`: جدولة الانتقال التالي.
- `tabs`: إدارة علامة الأتمتة ومراقبة التحميل.
- `scripting`: حقن Content Script عند الحاجة.
- `sidePanel`: واجهة التحكم المستمرة.
- `activeTab`: مسار أقل صلاحيات للتفاعل مع علامة يفعّلها المستخدم.
- `host_permissions` محددة على `x.com` و`twitter.com` فقط.
- توجد صلاحية Origin اختيارية في Manifest للنسخ المستقبلية التي تفتح بنوكًا خارجية تلقائيًا؛ يجب طلبها وقت الحاجة فقط.

لا تُستخدم صلاحيات `cookies` أو `webRequest` أو `debugger`، ولا تُرسل البيانات إلى Backend.

## Workspaces

يحتوي X-Pilot الآن على مساحات عمل مستقلة لكل مشروع. لكل Workspace Queue وبنوك تغريدات وجلسة وسجل محاولات خاص بها، مع إمكانية التبديل من أعلى Side Panel. تبقى الأتمتة Runtime عالمية بمالك واحد فقط في كل لحظة، لذلك لا يمكن تشغيل Workspace ثانية أثناء تشغيل Workspace أخرى، بينما يمكن تصفح بياناتها غير التشغيلية.

تستخدم Workspaces مخطط تخزين محليًا بإصدار `schemaVersion: 4`. يحتفظ النموذج الجديد بمفاتيح مستقلة للـRuntime والإعدادات وQueue وSession Records وPublish Attempts. عند التحديث من إصدار قديم، تُرحّل مفاتيح `xQueueState` و`xQueueSettings` إلى Workspace افتراضية باسم **مساحة العمل الافتراضية** دون حذف البيانات القديمة أثناء عملية الترحيل الأولى. راجع [مقترح Data Architecture](docs/data-architecture.md) للتفاصيل.

## القيود المعروفة في هذه المرحلة

- Selectors الخاصة بـ X قد تحتاج تحديثًا عند تغير الواجهة.
- استخراج Redirect URLs غير منفذ تلقائيًا؛ تُقبل فقط الروابط ذات مضيف X/Twitter مباشرة.
- نتيجة النشر تستعمل مؤشرًا محافظًا (`PUBLISHED_UNVERIFIED`) عندما لا يمكن التأكد من اختفاء المحرر.
- واجهة Refresh Bank وExport/Import وRecovery الكامل بعد كل سيناريو Restart ستكتمل في المراحل التالية.
- لا تبدأ جلسة غير مكتملة تلقائيًا بعد إعادة التشغيل دون إضافة مسار Resume صريح في الواجهة.

## البنية

```text
src/
├── background/service-worker.ts
├── content/content-entry.ts
├── content/providers/x-provider-adapter.ts
├── domain/models.ts
├── domain/state-machine.ts
├── extraction/bank-parser.ts
├── storage/storage-repository.ts
└── ui/main.tsx
```

## الخطة التالية

1. إضافة اختبارات وحدة لـ URL Parser وState Machine.
2. فصل محرك الأتمتة عن Service Worker إلى `automation-engine.ts`.
3. إضافة Refresh Bank وExport/Import.
4. إضافة Recovery UI: Resume / Start Over / Cancel.
5. إضافة اختبارات تكامل لدورة Tab وAlarm وRetry.
6. تحديث Adapter عبر Fixtures عند ظهور تغيرات في واجهة X.
