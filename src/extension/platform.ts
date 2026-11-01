// Only fixed business endpoints are exposed. Page/model text cannot choose a server, recipient or credentials.
import { scopeRoot, withinRoots } from '@src/browser-control';
import { platformStorage, platformCredentials, platformHealth } from '@src/store/platform';
import type { PlatformConfig, PlatformCredentials, WatchStatus } from '@src/store/platform';
import { PLATFORM_REQUEST } from '@src/ui/platform-protocol';
import type { PlatformCommand, PlatformResponse } from '@src/ui/platform-protocol';

export const PLATFORM_ALARM = 'nb-platform-notifications';
const DELIVERY_KEY = 'nb.platformDelivered';

interface PendingNotification {
  id: string;
  application_id: string | null;
  employee_id: string | null;
  kind: string;
  message: string;
  at: string;
}

export function validatePlatform(config: PlatformConfig): PlatformConfig {
  const pageRoot = scopeRoot(config.pageRoot);
  const api = new URL(config.apiBaseUrl);
  if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.search || api.hash) {
    throw new Error('后端地址必须是不含账号和查询参数的 HTTP(S) 地址。');
  }
  return { pageRoot, apiBaseUrl: api.href.replace(/\/+$/, '') };
}

async function request<T>(
  path: string,
  body?: object,
  credentials?: PlatformCredentials | null,
  signal?: AbortSignal,
): Promise<T> {
  const config = validatePlatform(await platformStorage.get());
  const auth = credentials === undefined ? await platformCredentials.get() : credentials;
  const response = await fetch(config.apiBaseUrl + path, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { 'user-id': auth.userId, 'x-auth-token': auth.token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) throw new Error('管理员登录已失效，请在平台设置中重新登录。');
  if (!response.ok) throw new Error(`平台接口返回 HTTP ${response.status}。`);
  const result = (await response.json()) as { success: boolean; data: T; err_code?: string; err_msg?: string };
  if (result.success !== true) throw new Error(`平台操作失败：${result.err_code ?? 'UNKNOWN'} ${result.err_msg ?? ''}`);
  return result.data;
}

async function requireConnection(): Promise<void> {
  if (!(await platformCredentials.get())) throw new Error('请先在平台设置中登录管理员账号。');
}

export async function watchStatus(signal?: AbortSignal): Promise<WatchStatus> {
  await requireConnection();
  return request('/api/v1/expert-mode/watch', undefined, undefined, signal);
}

export async function setWatch(enabled: boolean, signal?: AbortSignal): Promise<WatchStatus> {
  await requireConnection();
  if (enabled && !(await chrome.permissions.contains({ permissions: ['notifications'] }))) {
    throw new Error('请先在平台设置中允许桌面通知，然后再启用自动审批。');
  }
  const status = await request<WatchStatus>('/api/v1/expert-mode/watch', { enabled }, undefined, signal);
  await chrome.alarms.create(PLATFORM_ALARM, { periodInMinutes: 0.5 });
  return status;
}

async function dispatch(command: PlatformCommand): Promise<PlatformResponse> {
  switch (command.op) {
    case 'configure': {
      const config = validatePlatform(command.config);
      const old = await platformStorage.get();
      if (await platformCredentials.get()) {
        if (old.apiBaseUrl !== config.apiBaseUrl || old.pageRoot !== config.pageRoot) {
          throw new Error('修改平台地址前请先暂停任务并断开登录。');
        }
      }
      await platformStorage.set(config);
      return { ok: true };
    }
    case 'login': {
      const data = await request<{ user_id: string; token: string; role: string }>(
        '/api/v1/user/login',
        { username: command.username, password: command.password },
        null,
      );
      if (data.role !== 'admin' || !data.user_id || !data.token) throw new Error('需要管理员账号。');
      await platformCredentials.set({ userId: data.user_id, token: data.token });
      await chrome.alarms.create(PLATFORM_ALARM, { periodInMinutes: 0.5 });
      await platformHealth.set({ error: null, checkedAt: null });
      return { ok: true, connected: true, status: await watchStatus() };
    }
    case 'status':
      if (!(await platformCredentials.get())) return { ok: true, connected: false };
      return { ok: true, connected: true, status: await watchStatus() };
    case 'set-watch':
      return { ok: true, connected: true, status: await setWatch(command.enabled) };
    case 'disconnect': {
      const credentials = await platformCredentials.get();
      if (credentials) {
        const status = await watchStatus();
        if (status.enabled) throw new Error('请先暂停自动审批，再断开登录。');
        await request('/api/v1/user/logout', {});
      }
      await platformCredentials.set(null);
      await chrome.alarms.clear(PLATFORM_ALARM);
      return { ok: true, connected: false };
    }
  }
}

let polling: Promise<void> | null = null;

/** The running promise is short-lived; only delivery records survive service worker suspension. */
export function pollNotifications(): Promise<void> {
  if (polling) return polling;
  polling = poll().finally(() => {
    polling = null;
  });
  return polling;
}

async function poll(): Promise<void> {
  if (!(await platformCredentials.get())) return;
  try {
    if (!(await chrome.permissions.contains({ permissions: ['notifications'] }))) {
      throw new Error('桌面通知权限未开启，待发通知保留在服务器。');
    }
    const { notifications } = await request<{ notifications: PendingNotification[] }>(
      '/api/v1/expert-mode/notifications',
    );
    if (!Array.isArray(notifications)) throw new Error('平台通知响应格式无效。');
    const credentials = (await platformCredentials.get())!;
    const config = validatePlatform(await platformStorage.get());
    const delivered = ((await chrome.storage.local.get(DELIVERY_KEY))[DELIVERY_KEY] ?? {}) as Record<string, true>;
    for (const notification of notifications) {
      if (!notification.id || !['approved', 'error'].includes(notification.kind) || !notification.at)
        throw new Error('平台通知内容无效。');
      const key = JSON.stringify([config.apiBaseUrl, credentials.userId, notification.id]);
      // Never display untrusted application reasons or a URL chosen by the server/model in a system notification.
      if (!delivered[key]) {
        await chrome.notifications.create(`nb-whitelist:${notification.id}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('/icon-128.png'),
          title: '白名单自动审批',
          message:
            notification.kind === 'approved'
              ? `工号 ${String(notification.employee_id ?? '').slice(0, 80)} 的申请已自动通过。${notification.at}`
              : '自动审批任务需要处理，请打开平台设置查看。',
        });
        delivered[key] = true;
        await chrome.storage.local.set({ [DELIVERY_KEY]: delivered });
      }
      await request(`/api/v1/expert-mode/notifications/${encodeURIComponent(notification.id)}/ack`, {});
      delete delivered[key];
      await chrome.storage.local.set({ [DELIVERY_KEY]: delivered });
    }
    await platformHealth.set({ error: null, checkedAt: new Date().toISOString() });
  } catch (error) {
    await platformHealth.set({
      error: error instanceof Error ? error.message : '通知检查失败。',
      checkedAt: new Date().toISOString(),
    });
  }
}

export function listenForPlatform(): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
    const command = message as { type?: string } & PlatformCommand;
    if (command?.type !== PLATFORM_REQUEST) return;
    const allowed = ['/options.html', '/sidepanel.html'].map(path => chrome.runtime.getURL(path));
    if (sender.id !== chrome.runtime.id || !allowed.some(url => sender.url?.split(/[?#]/)[0] === url)) return;
    void dispatch(command).then(reply, error =>
      reply({ ok: false, error: error instanceof Error ? error.message : '平台操作失败。' }),
    );
    return true;
  });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === PLATFORM_ALARM) void pollNotifications();
  });
  listenForNotificationClicks();
  chrome.permissions.onAdded.addListener(listenForNotificationClicks);
  void platformCredentials.get().then(async credentials => {
    if (credentials) {
      await chrome.alarms.create(PLATFORM_ALARM, { periodInMinutes: 0.5 });
      await pollNotifications();
    }
  });
}

function notificationClicked(id: string): void {
  if (!id.startsWith('nb-whitelist:')) return;
  void platformStorage.get().then(async config => {
    const target = new URL('construct/expert-whitelist', new URL('/', config.pageRoot)).href;
    if (withinRoots(target, [config.pageRoot])) await chrome.tabs.create({ url: target });
    else await chrome.runtime.openOptionsPage();
  });
}

function listenForNotificationClicks(): void {
  if (chrome.notifications && !chrome.notifications.onClicked.hasListener(notificationClicked)) {
    chrome.notifications.onClicked.addListener(notificationClicked);
  }
}

/** Delete everything must first stop the server task, while its administrator connection still exists. */
export async function clearPlatformConnection(): Promise<void> {
  if (await platformCredentials.get()) {
    const status = await watchStatus();
    if (status.enabled) await setWatch(false);
  }
  await chrome.alarms.clear(PLATFORM_ALARM);
  if (polling) await polling;
  await chrome.storage.local.remove(['nb.platform', 'nb.platformCredentials', 'nb.platformHealth', DELIVERY_KEY]);
}
