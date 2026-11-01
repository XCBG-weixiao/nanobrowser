import type { PlatformConfig, WatchStatus } from '@src/store/platform';

export const PLATFORM_REQUEST = 'nb.platform.request';
export type PlatformCommand =
  | { op: 'configure'; config: PlatformConfig }
  | { op: 'login'; username: string; password: string }
  | { op: 'status' }
  | { op: 'set-watch'; enabled: boolean }
  | { op: 'disconnect' };

export interface PlatformResponse {
  ok: boolean;
  error?: string;
  connected?: boolean;
  status?: WatchStatus;
}

export function platformCommand(command: PlatformCommand): Promise<PlatformResponse> {
  return chrome.runtime.sendMessage({ type: PLATFORM_REQUEST, ...command });
}
