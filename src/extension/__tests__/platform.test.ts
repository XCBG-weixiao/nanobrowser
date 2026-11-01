import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { platformCredentials, platformHealth, platformStorage } from '@src/store/platform';
import { pollNotifications, setWatch, validatePlatform, watchStatus } from '../platform';

const memory: Record<string, unknown> = {};
const create = vi.fn();
const fetcher = vi.fn();
const response = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });

beforeEach(async () => {
  Object.keys(memory).forEach(key => delete memory[key]);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string | string[]) =>
          Object.fromEntries((Array.isArray(key) ? key : [key]).map(k => [k, memory[k]])),
        set: async (values: object) => {
          Object.assign(memory, structuredClone(values));
        },
      },
    },
    permissions: { contains: async () => true },
    notifications: { create },
    runtime: { getURL: (path: string) => 'chrome-extension://test' + path },
    alarms: { create: vi.fn() },
  });
  vi.stubGlobal('fetch', fetcher);
  create.mockReset();
  create.mockResolvedValue('notification');
  fetcher.mockReset();
  await platformStorage.set({ pageRoot: 'http://127.0.0.1:3001/', apiBaseUrl: 'http://127.0.0.1:5670' });
  await platformCredentials.set({ userId: 'admin', token: 'synthetic-session' });
});
afterEach(() => vi.unstubAllGlobals());

describe('platform business client', () => {
  it('uses fixed endpoints, authenticated requests and no redirect following', async () => {
    fetcher.mockResolvedValueOnce(response({ enabled: true }));
    await watchStatus();
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:5670/api/v1/expert-mode/watch');
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { 'user-id': 'admin', 'x-auth-token': 'synthetic-session' },
    });
    expect(() =>
      validatePlatform({ pageRoot: 'https://user:password@platform.test/', apiBaseUrl: 'https://platform.test' }),
    ).toThrow();
  });
  it('does not enable without notification permission', async () => {
    chrome.permissions.contains = vi.fn(async () => false);
    await expect(setWatch(true)).rejects.toThrow('通知');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps failed notification delivery pending and never calls approval', async () => {
    fetcher.mockResolvedValueOnce(
      response({ notifications: [{ id: 'a', kind: 'approved', employee_id: '1001', at: '2026-11-02' }] }),
    );
    create.mockRejectedValueOnce(new Error('permission denied'));
    await pollNotifications();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await platformHealth.get()).error).toContain('permission denied');
    expect(fetcher.mock.calls.every(([url]) => !String(url).includes('/review'))).toBe(true);
  });
  it('after an ack timeout, retries ack without displaying or approving again', async () => {
    const batch = {
      notifications: [{ id: 'a', application_id: 'app-a', kind: 'approved', employee_id: '1001', at: '2026-11-02' }],
    };
    fetcher.mockResolvedValueOnce(response(batch)).mockRejectedValueOnce(new Error('ack timeout'));
    await pollNotifications();
    fetcher.mockResolvedValueOnce(response(batch)).mockResolvedValueOnce(response(true));
    await pollNotifications();
    expect(create).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/ack'))).toHaveLength(2);
    expect((await platformHealth.get()).error).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/review'))).toBe(false);
  });
  it('does not acknowledge malformed or refused business results', async () => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ success: false, err_code: 'E4030' })));
    await pollNotifications();
    expect(create).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await platformHealth.get()).error).toContain('E4030');
  });
});
