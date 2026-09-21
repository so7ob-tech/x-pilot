import type { DuplicatePolicy, QueueItem, Settings, TweetBank, Workspace } from './models';

export type PreflightCheckStatus = 'PASS' | 'WARN' | 'FAIL';
export interface PreflightCheck { id: string; status: PreflightCheckStatus; message: string; details?: string; blocking: boolean; }
export interface PreflightCounts { total: number; ready: number; published: number; failed: number; skipped: number; duplicates: number; publishedDuplicates: number; invalid: number; }
export interface PreflightResult { ready: boolean; checkedAt: number; workspaceId: string; summary: string; checks: PreflightCheck[]; counts: PreflightCounts; }

interface PreflightInput { workspace?: Workspace; queue: QueueItem[]; banks: TweetBank[]; automationWorkspaceId?: string; alarmsAvailable: boolean; permissionsGranted: boolean; settings: Settings; xInspection?: { pageKind: 'X' | 'LOGIN' | 'CHALLENGE' | 'ERROR' | 'UNKNOWN'; composerFound: boolean; contentPresent: boolean; postButtonFound: boolean; postButtonEnabled: boolean } | null; now?: number; }

export function runPreflight(input: PreflightInput): PreflightResult {
  const now = input.now ?? Date.now();
  const checks: PreflightCheck[] = [];
  const add = (id: string, status: PreflightCheckStatus, message: string, details: string | undefined, blocking: boolean) => checks.push({ id, status, message, details, blocking });
  const workspace = input.workspace;
  const published = input.queue.filter((item) => item.status === 'PUBLISHED' || item.status === 'PUBLISHED_UNVERIFIED').length;
  const failed = input.queue.filter((item) => item.status === 'FAILED').length;
  const skipped = input.queue.filter((item) => item.status === 'SKIPPED').length;
  const invalid = input.queue.filter((item) => !/^https?:\/\/\S+$/i.test(item.targetUrl.trim())).length;
  const duplicateItems = input.queue.filter((item) => item.duplicateStatus === 'DUPLICATE').length;
  const publishedDuplicates = input.queue.filter((item) => item.duplicateStatus === 'PUBLISHED_DUPLICATE').length;
  const runnable = input.queue.filter((item) => ['PENDING', 'FAILED'].includes(item.status) && !item.duplicateStatus?.includes('PUBLISHED')).length;

  if (workspace && !workspace.archived) add('workspace', 'PASS', 'Workspace النشطة صالحة', workspace.name, false);
  else add('workspace', 'FAIL', 'لا توجد Workspace نشطة صالحة', 'أنشئ Workspace أو ألغِ أرشفتها.', true);
  if (input.queue.length > 0) add('queue-not-empty', 'PASS', `Queue تحتوي على ${input.queue.length} عنصر`, undefined, false);
  else add('queue-not-empty', 'FAIL', 'Queue فارغة', 'أضف عناصر من Tweet Bank قبل Start.', true);
  if (runnable > 0) add('runnable-items', 'PASS', `${runnable} عنصر جاهز للتنفيذ`, undefined, false);
  else add('runnable-items', 'FAIL', 'لا توجد عناصر قابلة للتنفيذ', 'العناصر المنشورة أو المتخطاة لا تُعتبر جاهزة.', true);
  if (!input.automationWorkspaceId || input.automationWorkspaceId === workspace?.id) add('automation-owner', 'PASS', 'لا يوجد تعارض في مالك محرك الأتمتة', undefined, false);
  else add('automation-owner', 'FAIL', 'Workspace أخرى تشغّل محرك الأتمتة', input.automationWorkspaceId, true);
  if (invalid > 0) add('queue-validity', 'FAIL', `${invalid} رابط غير صالح`, 'صحح الروابط قبل بدء Queue.', true);
  else add('queue-validity', 'PASS', 'روابط Queue صالحة', undefined, false);
  if (input.banks.some((bank) => !bank.archived && /^https?:\/\/\S+$/i.test(bank.url))) add('bank-metadata', 'PASS', 'بيانات Tweet Bank صالحة', undefined, false);
  else add('bank-metadata', 'WARN', 'لا يوجد Tweet Bank صالح مرتبط', 'يمكن تشغيل Queue الموجودة، لكن يُفضّل مراجعة البنك.', false);
  if (duplicateItems > 0 || publishedDuplicates > 0) {
    const blocking = input.settings.duplicatePolicy === 'BLOCK' && publishedDuplicates > 0;
    add('duplicates', blocking ? 'FAIL' : 'WARN', `${duplicateItems + publishedDuplicates} عنصر مكرر`, `${publishedDuplicates} سبق نشره. السياسة الحالية: ${input.settings.duplicatePolicy}.`, blocking);
  } else add('duplicates', 'PASS', 'لا توجد تكرارات معروفة', undefined, false);
  if (input.settings.intervalMinutes > 0) add('interval', 'PASS', `الفاصل ${input.settings.intervalMinutes} دقيقة`, undefined, false);
  else add('interval', 'FAIL', 'الفاصل الزمني غير صالح', 'يجب أن يكون أكبر من صفر.', true);
  if (input.settings.maxRetries >= 0 && input.settings.maxRetries <= 10) add('retry-config', 'PASS', `عدد المحاولات ${input.settings.maxRetries}`, undefined, false);
  else add('retry-config', 'FAIL', 'إعداد المحاولات غير صالح', 'استخدم قيمة بين 0 و10.', true);
  add('permissions', input.permissionsGranted ? 'PASS' : 'FAIL', input.permissionsGranted ? 'صلاحيات X متاحة' : 'صلاحيات X غير متاحة', undefined, !input.permissionsGranted);
  add('alarms', input.alarmsAvailable ? 'PASS' : 'FAIL', input.alarmsAvailable ? 'نظام التنبيهات متاح' : 'نظام التنبيهات غير متاح', undefined, !input.alarmsAvailable);

  if (!input.xInspection) add('x-adapter', 'WARN', 'لم يتم فحص X بعد', 'افتح تبويب X ثم أعد الفحص.', false);
  else if (input.xInspection.pageKind === 'LOGIN') add('x-adapter', 'FAIL', 'X يحتاج إلى تسجيل الدخول', undefined, true);
  else if (input.xInspection.pageKind === 'CHALLENGE') add('x-adapter', 'FAIL', 'تم اكتشاف Challenge في X', undefined, true);
  else if (input.xInspection.pageKind !== 'X') add('x-adapter', 'FAIL', 'X Adapter لم يتعرف على الصفحة', undefined, true);
  else if (!input.xInspection.composerFound || !input.xInspection.postButtonFound || !input.xInspection.postButtonEnabled) add('x-adapter', 'FAIL', 'Composer أو زر Post غير جاهز', undefined, true);
  else add('x-adapter', 'PASS', 'X Adapter جاهز', undefined, false);

  const blockingFailures = checks.filter((check) => check.status === 'FAIL' && check.blocking);
  const ready = blockingFailures.length === 0 && runnable > 0;
  const summary = ready ? `جاهز للنشر: ${runnable} / ${input.queue.length}` : `غير جاهز: ${blockingFailures.length} مشكلة مانعة`;
  return { ready, checkedAt: now, workspaceId: workspace?.id ?? '', summary, checks, counts: { total: input.queue.length, ready: runnable, published, failed, skipped, duplicates: duplicateItems, publishedDuplicates, invalid } };
}
