import type { SessionStatus } from './models';

export type AlarmFailureDecision =
  | { action: 'RETRY'; alarmName: 'x-queue-next-item' | 'x-queue-scheduled-start'; when: number; failureCount: number }
  | { action: 'FAIL'; failureCount: number; reason: string };

export function decideAlarmFailure(status: Extract<SessionStatus, 'WAITING' | 'SCHEDULED'>, nextRunAt: number | undefined, failureCount: number, now: number, maxRetries = 3): AlarmFailureDecision {
  const nextFailureCount = failureCount + 1;
  if (nextRunAt && nextFailureCount <= maxRetries) {
    return {
      action: 'RETRY',
      alarmName: status === 'SCHEDULED' ? 'x-queue-scheduled-start' : 'x-queue-next-item',
      when: Math.max(now + 1_000, nextRunAt),
      failureCount: nextFailureCount,
    };
  }
  return { action: 'FAIL', failureCount: nextFailureCount, reason: 'ALARM_HANDLER_FAILED_AFTER_RETRIES' };
}
