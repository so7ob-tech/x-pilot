import type { RuntimeMessage } from '../../domain/models';

export type RuntimeResponse<T = any> = T & { error?: string };

/** The only runtime bridge used by Side Panel presentation modules. */
export function sendRuntime<T = any>(message: RuntimeMessage): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message) as Promise<RuntimeResponse<T>>;
}
