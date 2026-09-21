# X-Pilot — Data Architecture Proposal

## الخلاصة التنفيذية

النموذج الحالي في X-Pilot قابل للاستخدام، لكنه يضع `workspace` و`banks` و`queue` و`session` و`history` داخل كائن واحد باسم `WorkspaceState`. هذا الترتيب مناسب لمرحلة مبكرة، لكنه يخلط ثلاثة أنواع مختلفة من البيانات:

1. **بيانات مملوكة للمشروع** وتبقى حتى بعد انتهاء الأتمتة، مثل Workspace وTweet Banks وQueue Items.
2. **حالة تشغيلية مؤقتة** يجب استعادتها أو تنظيفها بعد إعادة تشغيل Service Worker، مثل التبويب والـAlarm والعنصر الحالي.
3. **سجلات تاريخية غير قابلة للتغيير نسبيًا**، مثل جلسات النشر ومحاولات النشر.

التوصية النهائية هي اعتماد نموذج **Workspace-owned data مع Runtime مركزي واحد وسجلات append-oriented**. لا يلزم إدخال قاعدة بيانات جديدة الآن. يمكن تنفيذ هذا النموذج فوق `chrome.storage.local` مع مفاتيح مستقلة وإصدار مخطط جديد. هذا يحافظ على بساطة الإضافة ويجعل حدود البيانات أوضح، ويمنع تخزين مؤشرات Analytics كبيانات مكررة.

> **القرار المقترح:** افصل Runtime عن Records، واجعل `WorkspaceState` طبقة توافق أو View مركبة بدل أن يكون النموذج الأساسي الدائم.

## نتائج فحص النموذج الحالي

### ما هو صحيح وقابل للإبقاء

يملك كل Queue Item وTweet Bank وWorkspace معرفًا ثابتًا، وتوجد علاقات صريحة عبر `workspaceId` و`sourceBankId`. كما أن `PublishAttempt` يحمل `sessionId` و`queueItemId`، وهذا يكفي لربط المحاولة بجلسة وعنصر محددين.

تستخدم الإضافة حاليًا مفتاحًا عامًا للبيانات الوصفية باسم `xPilotMeta`، ومفتاحًا لكل Workspace بصيغة `xPilotWorkspace:<workspaceId>`. هذا العزل مناسب لمنع اختلاط بيانات Workspaces.

يحتوي النظام على `schemaVersion` وترحيل من الحالة القديمة، كما أن النسخ الاحتياطي يعزل بعض الحقول المؤقتة مثل `automationTabId` و`operationId`. هذه نقطة صحيحة يجب الحفاظ عليها.

### المشكلات المعمارية الحالية

| الملاحظة | الأثر | القرار المقترح |
|---|---|---|
| `WorkspaceState` يجمع جميع الكيانات | كل تعديل صغير يعيد كتابة Aggregate كبير، ويصعب تحديد مصدر الحقيقة | الاحتفاظ به كـcompatibility View، وفصل المفاتيح الأساسية تدريجيًا |
| `AutomationSession` تستخدم للحالة الحالية ولبيانات الجلسة | حقول مثل `automationTabId` و`nextRunAt` تختلط مع إعدادات الجلسة | فصلها إلى `AutomationSessionRuntime` و`AutomationSessionRecord` |
| `AppState` تكرر جزءًا من `WorkspaceState` | وجود نموذجين لنفس Queue وSession وHistory يزيد احتمالات عدم الاتساق | جعل `AppState` DTO مشتقًا للواجهة فقط |
| `Workspace.automationProfile` يحمل إعدادات Workspace | الاسم يوحي بأنه Profile مستقل، لكنه جزء اختياري داخل Workspace | نقل الإعدادات إلى `WorkspaceSettings` مستقل مرتبط بـWorkspace |
| `HistoricalSession` يحتوي عدادات مشتقة قابلة للتغيير | قد تختلف العدادات عن محاولات النشر الفعلية | اعتباره Snapshot للعرض، مع اعتماد `PublishAttempt` ونتائج العناصر كمصادر تدقيق |
| `history` مصفوفة محاولات داخل Workspace | الكتابة المتكررة وإدارة الحجم تصبح أصعب مع نمو السجل | سجل محاولات مستقل محدود بسياسة retention واضحة |
| `BankSnapshotItem` و`BankDiffResult` تختلط مع البيانات الدائمة | نتائج Refresh المؤقتة قد تُعامل كبيانات مصدر | فصل Snapshot دائم مختصر عن Diff Session مؤقتة |
| `BACKUP_APP_VERSION` ثابت قديم في Repository | النسخة الاحتياطية قد لا تعكس إصدار الإضافة الحالي | قراءة الإصدار من `chrome.runtime.getManifest()` |
| تحديث Workspace State يغيّر `lastActivityAt` تلقائيًا | قراءة أو تعديل داخلي قد يبدو كنشاط مستخدم | تعريف Activity Events أو تحديث الحقل عند عمليات المجال فقط |

## النموذج النهائي المقترح

### 1. AppMetadata

هذا هو Root metadata العام للتطبيق. يجب أن يحتوي فقط على مؤشرات وفهارس عامة، وليس بيانات Workspace نفسها.

```ts
interface AppMetadata {
  schemaVersion: 4;
  appVersion: string;
  activeWorkspaceId: string;
  automationWorkspaceId?: string;
  workspaceOrder: string[];
  createdAt: number;
  updatedAt: number;
}
```

`automationWorkspaceId` هو Lock منطقي على مستوى التطبيق. لا يمثل جلسة كاملة، ولا يجب أن يحتوي على بيانات تبويب أو Queue.

**Storage key:** `xPilot:meta`

### 2. GlobalSettings

الإعدادات العامة التي ترثها Workspaces الجديدة أو التي لا تملك Override خاصًا بها.

```ts
interface GlobalSettings {
  intervalMinutes: number;
  maxRetries: number;
  failureBehavior: 'CONTINUE' | 'PAUSE';
  confirmBeforeStart: boolean;
  keepAutomationTabOpen: boolean;
  closeTabOnComplete: boolean;
  duplicatePolicy: 'BLOCK' | 'WARN' | 'ALLOW';
  publishingWindows: PublishingWindow[];
  timezone: string;
  notificationsEnabled: boolean;
  badgeMode: 'COUNT' | 'STATUS' | 'NONE';
  updatedAt: number;
}
```

**Storage key:** `xPilot:settings:global`

اسم `Settings` الحالي يمكن الاحتفاظ به في TypeScript لأسباب توافق، لكن النموذج الدائم الأفضل هو `GlobalSettings` حتى يظهر الفرق بينها وبين إعدادات Workspace.

### 3. Workspace

يمثل المشروع أو الحملة. يجب أن يحتوي على بيانات التعريف فقط.

```ts
interface Workspace {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  favorite: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  lastActivityAt?: number;
}
```

لا ينبغي أن يحتوي Workspace على `automationProfile` أو Queue أو Banks أو Session. العلاقات تُحفظ عبر `workspaceId`.

**Storage key:** `xPilot:workspace:<workspaceId>`

### 4. WorkspaceSettings

يمثل Overrides الخاصة بـWorkspace. الحقول اختيارية حتى يمكن تطبيق Global Defaults دون نسخها داخل كل Workspace.

```ts
interface WorkspaceSettings {
  workspaceId: string;
  overrides: Partial<Omit<GlobalSettings, 'updatedAt'>>;
  createdAt: number;
  updatedAt: number;
}
```

يُحسب الإعداد الفعال في الذاكرة:

```ts
function resolveSettings(global: GlobalSettings, local?: WorkspaceSettings): ResolvedSettings {
  return { ...global, ...(local?.overrides ?? {}) };
}
```

**Storage key:** `xPilot:workspace-settings:<workspaceId>`

بهذا لا تُخزّن الإضافة نسخة كاملة من Global Defaults لكل Workspace.

### 5. TweetBank

يمثل مصدر الروابط أو المحتوى. يحتفظ البنك بمعلومات المصدر وملخص آخر قراءة، وليس Queue نفسها.

```ts
interface TweetBank {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  url: string;
  favorite: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  lastExtractedAt?: number;
  lastExtractedCount?: number;
  lastSnapshotId?: string;
}
```

**Storage key:** `xPilot:bank:<bankId>`

### 6. BankSnapshot

يمثل آخر لقطة مستخرجة من البنك. لا يجب أن يكون Diff نفسه هو المصدر الدائم.

```ts
interface BankSnapshot {
  id: string;
  bankId: string;
  workspaceId: string;
  capturedAt: number;
  items: BankSnapshotItem[];
}

interface BankSnapshotItem {
  url: string;
  label?: string;
  contentFingerprint?: string;
  normalizedContent?: string;
}
```

يمكن تطبيق retention والاحتفاظ بآخر لقطة أو عدد محدود من اللقطات. لا حاجة لتخزين كل نتيجة Diff بعد انتهاء المراجعة.

**Storage key:** `xPilot:bank-snapshot:<snapshotId>`

### 7. QueueItem

يمثل عنصرًا مستقلًا في Queue. يجب أن يكون هذا الكيان مصدر الحقيقة لحالة العنصر الحالية، مع فصل الحالة التشغيلية العابرة عن السجل التاريخي.

```ts
interface QueueItem {
  id: string;
  workspaceId: string;
  sourceBankId?: string;
  sourceBankUrl: string;
  targetUrl: string;
  label?: string;
  position: number;
  status: QueueItemStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  publishedAt?: number;
  lastError?: string;
  contentFingerprint?: string;
  normalizedContent?: string;
  duplicateStatus?: 'UNIQUE' | 'DUPLICATE' | 'PUBLISHED_DUPLICATE';
  duplicateOfItemId?: string;
}
```

`operationId` الحالي ليس ملكًا دائمًا للعنصر. الأفضل نقله إلى Runtime Lock أو `QueueItemRuntime`, لأن قيمته لا تصلح للاستعادة من Backup أو للاعتماد التاريخي.

**Storage key:** `xPilot:queue:<workspaceId>` أو مجموعة مفاتيح `xPilot:queue-item:<itemId>`.

في المرحلة الحالية أوصي بمصفوفة Queue لكل Workspace، لأن حجم Queue صغير نسبيًا ولأن عمليات إعادة الترتيب تحتاج كتابة جماعية. لكن يجب أن تكون Queue منفصلة عن Workspace وSession في النموذج المنطقي.

### 8. AutomationSessionRuntime

يمثل الحالة الوحيدة القابلة للتشغيل الآن. لا يدخل في Analytics التاريخية، ولا يُصدّر إلى Backup إلا بعد إزالة الحقول المؤقتة.

```ts
interface AutomationSessionRuntime {
  workspaceId: string;
  sessionId: string;
  status: 'IDLE' | 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'WAITING' | 'STOPPED' | 'COMPLETED' | 'FAILED';
  currentItemId?: string;
  currentIndex: number;
  total: number;
  startedAt?: number;
  scheduledStartAt?: number;
  pausedAt?: number;
  completedAt?: number;
  nextRunAt?: number;
  automationTabId?: number;
  alarmName?: string;
  operationId?: string;
  updatedAt: number;
  version: number;
}
```

يجب أن يوجد Runtime واحد فقط على مستوى التطبيق، وليس Runtime مستقلًا قابلًا للتشغيل لكل Workspace في اللحظة نفسها. يمكن تخزينه في مفتاح مستقل:

**Storage key:** `xPilot:runtime:automation`

أما `automationWorkspaceId` في AppMetadata فيبقى Lock مختصرًا للتحقق السريع. يجب أن يكون `runtime.workspaceId` و`meta.automationWorkspaceId` متطابقين أو يكون كلاهما فارغًا.

### 9. AutomationSessionRecord

يمثل سجل جلسة بدأت فعليًا أو أُجدولت. لا يتضمن تبويب Chrome أو `operationId` أو Alarm runtime.

```ts
interface AutomationSessionRecord {
  id: string;
  workspaceId: string;
  bankId?: string;
  status: 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'WAITING' | 'COMPLETED' | 'STOPPED' | 'FAILED';
  startedAt: number;
  scheduledStartAt?: number;
  completedAt?: number;
  totalItems: number;
  publishedCount: number;
  failedCount: number;
  skippedCount: number;
  intervalMinutes: number;
  maxRetries: number;
  failureBehavior: 'CONTINUE' | 'PAUSE';
  timezone: string;
  createdAt: number;
  updatedAt: number;
  failureReason?: string;
}
```

هذه السجلات هي المصدر العملي لتاريخ الجلسات، لكنها لا ينبغي أن تكون المصدر الوحيد لتفاصيل المحاولات. العدادات الموجودة فيها تُعامل كـsnapshot سريع للعرض، ويمكن إعادة تدقيقها من `PublishAttempt` ونتائج Queue.

**Storage key:** `xPilot:sessions:<workspaceId>`

### 10. PublishAttempt

يمثل حدث محاولة نشر واحدة. هذا سجل append-oriented، ولا يجب تعديله بعد إضافته إلا في حالة تصحيح ترحيل موثق.

```ts
interface PublishAttempt {
  id: string;
  workspaceId: string;
  sessionId: string;
  queueItemId: string;
  targetUrl: string;
  timestamp: number;
  attemptNumber: number;
  action: 'PUBLISH';
  result: 'PUBLISHED' | 'PUBLISHED_UNVERIFIED' | 'PENDING' | 'FAILED' | 'SKIPPED';
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
  adapter?: string;
}
```

الاسم `history` الحالي عام جدًا. الأفضل تسميته `publishAttempts` في النموذج الدائم، مع إبقاء alias مؤقت للقراءة من schema قديم.

**Storage key:** `xPilot:attempts:<workspaceId>`

يجب تطبيق retention واضح. إذا استمر الحد الحالي عند 2,000 محاولة لكل Workspace، يجب إظهاره كسياسة مقصودة مثل `attemptRetentionLimit`، لا كسلوك صامت.

### 11. ActivityEvent — اختياري ومؤجل

لا أوصي بإضافته في الإصدار التالي إلا إذا احتاجت Analytics إلى نشاط يتجاوز جلسات النشر. يمكن لاحقًا إنشاء سجل خفيف للأحداث مثل إنشاء Workspace أو Refresh Bank أو Restore Backup.

في الوقت الحالي يكفي حساب `Last activity` من أعلى قيمة بين `Workspace.lastActivityAt` ووقت آخر Session أو Attempt. لا تضف ActivityEvent فقط لتغذية بطاقة Analytics.

## العلاقات الأساسية

```text
AppMetadata
 ├── activeWorkspaceId ───────────────► Workspace
 ├── automationWorkspaceId ──────────► Workspace
 └── workspaceOrder[] ───────────────► Workspace[]

Workspace
 ├── WorkspaceSettings
 ├── TweetBank[]
 ├── QueueItem[]
 ├── AutomationSessionRecord[]
 └── PublishAttempt[]

AutomationSessionRuntime
 ├── workspaceId ─────────────────────► Workspace
 ├── sessionId ───────────────────────► AutomationSessionRecord
 ├── currentItemId ──────────────────► QueueItem
 └── automationTabId / alarmName ────► Chrome runtime resources

QueueItem
 └── sourceBankId ────────────────────► TweetBank

BankSnapshot
 └── bankId ──────────────────────────► TweetBank
```

## مصدر الحقيقة لكل سؤال

| السؤال | مصدر الحقيقة |
|---|---|
| ما هي Workspace النشطة؟ | `AppMetadata.activeWorkspaceId` ثم `Workspace` |
| من يملك الأتمتة؟ | `AutomationSessionRuntime.workspaceId` مع Lock في `AppMetadata` |
| ما العنصر الجاري؟ | `AutomationSessionRuntime.currentItemId` ثم `QueueItem` |
| ما حالة Queue الحالية؟ | `QueueItem.status` |
| ماذا حدث في جلسة سابقة؟ | `AutomationSessionRecord` |
| كم محاولة حدثت؟ | `PublishAttempt[]` |
| ما البنك المرتبط بالعنصر؟ | `QueueItem.sourceBankId` |
| ما آخر قراءة للبنك؟ | `TweetBank.lastSnapshotId` ثم `BankSnapshot` |
| ما الإعداد الفعال؟ | `GlobalSettings` مدموجًا مع `WorkspaceSettings.overrides` |
| ما المؤشرات؟ | حساب مشتق من Records، وليس كيانًا مخزنًا |

## انتقال الحالة المقترح

### إنشاء الجلسة

عند جدولة Session أو بدءها، ينشئ النظام `AutomationSessionRecord`. إذا أصبحت الجلسة قابلة للتشغيل، ينشئ أو يحدّث `AutomationSessionRuntime` ويضع Lock في `AppMetadata`.

### تشغيل عنصر

يقرأ Runtime العنصر الحالي من `currentItemId`. يحدّث Queue Item إلى `OPENING` ثم `READY` ثم `PUBLISHING`. عند كل محاولة نشر، يضيف `PublishAttempt`. بعد النتيجة، يحدّث Queue Item وSession Record وRuntime في عملية منطقية واحدة قدر الإمكان.

### التوقف أو إعادة التشغيل

عند توقف Service Worker، لا تُعتبر Runtime بيانات تاريخية. عند `onStartup` أو `onInstalled`، يقرأ النظام Runtime ويطبّق Recovery Policy. العناصر العالقة في `OPENING` أو `READY` أو `PUBLISHING` تعود إلى `PENDING` مع سبب `RECOVERED_AFTER_RESTART`، ثم تتحول Runtime إلى `PAUSED` أو `COMPLETED` وفق وجود عنصر قابل للاستئناف.

### انتهاء الجلسة

عند إكمال أو إيقاف Session، يكتب النظام `completedAt` في `AutomationSessionRecord`، ويمسح `AutomationSessionRuntime` أو يترك Snapshot خاملًا واضحًا. يجب إزالة Lock من `AppMetadata` وإلغاء Alarm المرتبط.

## التخزين المقترح فوق chrome.storage.local

```text
xPilot:meta
xPilot:settings:global
xPilot:runtime:automation
xPilot:workspace:<workspaceId>
xPilot:workspace-settings:<workspaceId>
xPilot:bank:<bankId>
xPilot:bank-snapshot:<snapshotId>
xPilot:queue:<workspaceId>
xPilot:sessions:<workspaceId>
xPilot:attempts:<workspaceId>
xPilot:backup:last-export   // اختياري، والأفضل عدم تخزينه
```

لا أوصي بتخزين Diagnostics أو Analytics أو Preflight كحالة دائمة. هذه نتائج قابلة لإعادة الحساب، وقد تصبح قديمة فور تغير التبويب أو Alarm أو Queue.

## النسخ الاحتياطي والاستعادة

يجب أن يحتوي Backup على:

- `AppMetadata` بعد إزالة `automationWorkspaceId` أو ضبطه إلى `undefined`.
- `GlobalSettings`.
- Workspaces.
- WorkspaceSettings.
- TweetBanks.
- آخر BankSnapshots فقط وفق سياسة retention.
- Queue Items.
- AutomationSessionRecords.
- PublishAttempts وفق حد السجل.

ويجب ألا يحتوي Backup على:

- `automationTabId`.
- `operationId`.
- Alarm runtime.
- `contentInjectionInFlight` أو أي ذاكرة Service Worker.
- نتائج Diagnostics الحالية.
- بيانات تسجيل الدخول أو Cookies أو أسرار خارجية.

ينبغي رفع `formatVersion` إلى 2 بالتزامن مع schemaVersion 4، مع إبقاء قارئ `formatVersion: 1` للترحيل مرة واحدة.

## الترحيل من النموذج الحالي

أوصي بتنفيذ الترحيل على مراحل بدل تغيير كل المفاتيح دفعة واحدة.

### Schema v4

1. اقرأ `xPilotMeta` الحالي وWorkspaces الحالية.
2. أنشئ `xPilot:settings:global` من `globalSettings`.
3. لكل Workspace، انقل `automationProfile` إلى `xPilot:workspace-settings:<id>` ثم احذف الاعتماد عليه داخل Workspace الجديدة.
4. انقل `state.session` إلى `xPilot:runtime:automation` بعد إزالة `automationTabId` و`operationId` من السجلات التاريخية.
5. حوّل `historicalSessions` إلى `xPilot:sessions:<workspaceId>`.
6. حوّل `history` إلى `xPilot:attempts:<workspaceId>`.
7. أبقِ `xPilotWorkspace:<id>` كـcompatibility snapshot في الإصدار الأول من v4 إذا كانت الواجهة تحتاجه.
8. بعد نجاح الكتابة والتحقق، حدّث `schemaVersion` إلى 4.
9. لا تحذف المفاتيح القديمة في نفس العملية الأولى. احذفها في Migration Cleanup لاحق بعد نجاح تشغيل واحد أو أكثر.

### قواعد التحقق

يجب رفض الترحيل أو إيقافه جزئيًا إذا كان هناك:

- Workspace مفقودة من `workspaceOrder`.
- Queue Item يشير إلى Workspace مختلفة.
- Bank يشير إلى Workspace مختلفة.
- Queue Item يشير إلى Bank غير موجود.
- Runtime يشير إلى Workspace غير موجودة.
- Session Record يشير إلى Workspace مختلفة.

## Analytics وDiagnostics في النموذج النهائي

### Analytics

تبقى Analytics طبقة قراءة مشتقة. لا تُخزّن `successRate` أو `averageAttempts` أو `mostActiveBank` كحقول دائمة. تحسب من Session Records وPublish Attempts وQueue Items وBanks، مع Cache اختياري في الذاكرة فقط إذا احتاجت الواجهة إلى تحسين الأداء.

### Diagnostics

تبقى Diagnostics عملية قراءة فقط. تقرأ AppMetadata وRuntime وChrome Alarms وTabs وPermissions، ثم تستخدم `X_INSPECT` عند توفر تبويب مناسب. لا تحفظ Diagnostics في Storage، لأن نتيجة الفحص مرتبطة بلحظة زمنية وقد تصبح غير صحيحة بعد تغير حالة التبويب.

## قواعد الاتساق التي يجب اعتمادها

1. كل كيان دائم يملك `id` ثابتًا ولا يُعاد استخدامه.
2. كل كيان تابع يملك `workspaceId` صريحًا.
3. لا يوجد أكثر من `AutomationSessionRuntime` نشط على مستوى التطبيق.
4. لا تُكتب `PublishAttempt` دون `sessionId` و`queueItemId` صالحين، إلا أثناء ترحيل legacy موثق.
5. لا تُحفظ موارد Chrome المؤقتة داخل Backup.
6. لا تستخدم Analytics أو Diagnostics كمصدر حقيقة لأي عملية نشر.
7. التعديلات على Queue وRuntime يجب أن تتحقق من `operationId` عند العمليات الحساسة.
8. العمليات التي تفتح تبويبًا مؤقتًا يجب أن تستخدم `finally` للإغلاق.
9. يجب أن تكون حالات Queue وRuntime قابلة للتحقق عبر State Machine واحدة.
10. يجب أن تكون كل سياسة retention صريحة وقابلة للاختبار.

## ترتيب التنفيذ المقترح

لا أوصي بإعادة كتابة كاملة قبل الحاجة. الترتيب العملي هو:

1. إنشاء أنواع `AutomationSessionRuntime` و`AutomationSessionRecord` مع adapters للأنواع الحالية.
2. فصل `GlobalSettings` عن `WorkspaceSettings` مع إبقاء `getWorkspaceSettings()` كواجهة عامة.
3. نقل Runtime إلى مفتاح مستقل، ثم تحديث Recovery وAlarms.
4. نقل Attempts وSession Records إلى مفاتيح مستقلة مع إبقاء `WorkspaceState` للقراءة المؤقتة.
5. تحديث Backup إلى `formatVersion: 2` و`schemaVersion: 4`.
6. جعل Analytics وDiagnostics تستخدمان الـRepositories الجديدة فقط.
7. حذف `WorkspaceState` من الواجهة الداخلية بعد التأكد من عدم وجود مستهلكين مباشرين له.

## القرار النهائي

النموذج الأنسب لـX-Pilot ليس Aggregate واحدًا كبيرًا ولا قاعدة بيانات معقدة. النموذج الأفضل هو **سجل Workspace مستقل، Runtime مركزي واحد، سجلات Sessions وAttempts منفصلة، وإعدادات ذات وراثة واضحة**.

هذا القرار يحافظ على بساطة Manifest V3 و`chrome.storage.local`، ويحل الخلط الحالي بين الحالة المؤقتة والتاريخ، ويجعل Backup وRecovery وAnalytics وDiagnostics أكثر أمانًا وقابلية للاختبار.

## References

[1]: https://github.com/so7ob-tech/x-pilot "X-Pilot repository"
