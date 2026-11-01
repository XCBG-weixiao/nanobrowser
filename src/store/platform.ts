import { createStorage } from './storage';

export interface PlatformConfig {
  pageRoot: string;
  apiBaseUrl: string;
}

export const EMPTY_PLATFORM: PlatformConfig = { pageRoot: '', apiBaseUrl: '' };
export const platformStorage = createStorage<PlatformConfig>('nb.platform', EMPTY_PLATFORM, { liveUpdate: true });

/** Never exported or passed to the model. The connection UI writes credentials through the worker only. */
export interface PlatformCredentials {
  userId: string;
  token: string;
}

export const platformCredentials = createStorage<PlatformCredentials | null>('nb.platformCredentials', null);

export interface WatchStatus {
  enabled: boolean;
  owner: string | null;
  pending_count: number;
  approved_count: number;
  checked_at: string | null;
  error: string | null;
  runtime_error?: string | null;
  recent: Array<{ id: string; employee_id: string | null; kind: string; message: string; at: string }>;
}

export const platformHealth = createStorage<{ error: string | null; checkedAt: string | null }>(
  'nb.platformHealth',
  { error: null, checkedAt: null },
  { liveUpdate: true },
);
