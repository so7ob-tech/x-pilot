const userFacingErrors: Record<string, string> = {
  X_DAILY_POST_LIMIT_REACHED: 'لقد وصلت إلى الحد الأقصى لعدد المنشورات اليومية',
};

export function toUserFacingMessage(message?: string): string | undefined {
  if (!message) return message;
  return Object.entries(userFacingErrors).reduce(
    (current, [code, translation]) => current.replaceAll(code, translation),
    message,
  );
}

export function getUserFacingMessage(message: string): string {
  return toUserFacingMessage(message) ?? message;
}
