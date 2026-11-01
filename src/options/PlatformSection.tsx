import { useCallback, useEffect, useState } from 'react';
import { EMPTY_PLATFORM, platformStorage, platformHealth } from '@src/store/platform';
import type { WatchStatus } from '@src/store/platform';
import { platformCommand } from '@src/ui/platform-protocol';
import type { PlatformResponse } from '@src/ui/platform-protocol';
import { useStorage } from '@src/ui/hooks';
import { Button, Input, Notice } from '@src/ui/components';
import { requestOptionalPermissions } from '@src/ui/optional-permissions';
import { SettingsCard } from './SettingsCard';

export function PlatformSection() {
  const stored = useStorage(platformStorage, EMPTY_PLATFORM);
  const health = useStorage(platformHealth, { error: null, checkedAt: null });
  const [root, setRoot] = useState(stored.pageRoot);
  const [api, setApi] = useState(stored.apiBaseUrl);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<WatchStatus | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setRoot(stored.pageRoot);
    setApi(stored.apiBaseUrl);
  }, [stored.pageRoot, stored.apiBaseUrl]);
  const accept = useCallback((result: PlatformResponse) => {
    if (!result.ok) throw new Error(result.error);
    if (result.connected !== undefined) setConnected(result.connected);
    setStatus(result.status);
  }, []);
  const refresh = useCallback(async () => accept(await platformCommand({ op: 'status' })), [accept]);
  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : '平台操作失败。');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh().catch(e => setError(String(e.message)));
  }, [refresh]);
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => {
      void refresh().catch(e => setError(String(e.message)));
    }, 10_000);
    return () => clearInterval(timer);
  }, [connected, refresh]);
  return (
    <div className="flex flex-col gap-6">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="ok">{notice}</Notice> : null}
      <SettingsCard title="平台访问范围" description="Agent 只读取和操作下列网址及其子路径。未配置时不允许访问页面。">
        <form
          className="flex flex-col gap-4"
          onSubmit={e => {
            e.preventDefault();
            void act(async () => {
              accept(await platformCommand({ op: 'configure', config: { pageRoot: root, apiBaseUrl: api } }));
              setNotice('平台访问范围已保存。');
            });
          }}>
          <label htmlFor="platform-page-root" className="flex flex-col gap-2 text-sm">
            允许的平台网址
            <Input
              id="platform-page-root"
              required
              type="url"
              value={root}
              onChange={e => setRoot(e.target.value)}
              placeholder="http://127.0.0.1:3001/"
            />
          </label>
          <label htmlFor="platform-api-base" className="flex flex-col gap-2 text-sm">
            平台后端地址
            <Input
              id="platform-api-base"
              required
              type="url"
              value={api}
              onChange={e => setApi(e.target.value)}
              placeholder="http://127.0.0.1:5670"
            />
          </label>
          <Button type="submit" disabled={busy}>
            保存平台范围
          </Button>
        </form>
      </SettingsCard>
      <SettingsCard
        title="管理员连接"
        description="使用平台管理员账号登录。密码不保存在插件中，登录令牌仅保存在本机，不会发送给模型。">
        {connected ? (
          <div className="flex flex-col gap-3">
            <p>已连接管理员账号。任务授权账号：{status?.owner || '尚未启用'}</p>
            <Button
              disabled={busy || status?.enabled}
              onClick={() => void act(async () => accept(await platformCommand({ op: 'disconnect' })))}>
              断开登录
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={e => {
              e.preventDefault();
              void act(async () => {
                try {
                  accept(await platformCommand({ op: 'login', username, password }));
                } finally {
                  setPassword('');
                }
              });
            }}>
            <Input
              required
              aria-label="管理员账号"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="管理员账号"
            />
            <Input
              required
              aria-label="管理员密码"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="管理员密码"
            />
            <Button type="submit" disabled={busy || !stored.pageRoot || !stored.apiBaseUrl}>
              登录平台
            </Button>
          </form>
        )}
      </SettingsCard>
      <SettingsCard
        title="白名单自动审批"
        description="启用后自动同意已有和新增的待审批申请。服务器每 30 秒检查一次，关闭侧栏后仍继续。">
        <div className="flex flex-col gap-4">
          <p>
            任务状态：{status?.enabled ? '运行中' : '已暂停'}；待审批：{status?.pending_count ?? '—'}；累计自动通过：
            {status?.approved_count ?? '—'}
          </p>
          <p className="text-sm text-nb-muted">
            最近检查：{status?.checked_at ? new Date(status.checked_at).toLocaleString() : '尚未检查'}
          </p>
          {status?.error || status?.runtime_error ? (
            <Notice tone="error">{status.error || status.runtime_error}</Notice>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={busy || !connected || status?.enabled}
              onClick={() => {
                // Permission is requested directly in the click handler, before any asynchronous work.
                const permission = requestOptionalPermissions(['notifications']);
                void act(async () => {
                  if (!(await permission)) throw new Error('请允许桌面通知后再启用任务。');
                  accept(await platformCommand({ op: 'set-watch', enabled: true }));
                });
              }}>
              启用：已有和新增全部通过
            </Button>
            <Button
              disabled={busy || !connected || !status?.enabled}
              onClick={() => void act(async () => accept(await platformCommand({ op: 'set-watch', enabled: false })))}>
              暂停自动审批
            </Button>
            <Button disabled={busy || !connected} onClick={() => void act(refresh)}>
              刷新结果
            </Button>
          </div>
          <p className="text-sm text-nb-muted">
            浏览器桌面通知：Chrome 退出或电脑休眠期间的待发通知，会在恢复运行后补发。需允许浏览器及系统通知。
          </p>
          {health.error ? <Notice tone="error">{health.error}</Notice> : null}
          <ol className="flex flex-col gap-2 text-sm">
            {status?.recent.map(item => (
              <li key={item.id}>
                {item.at} · {item.message}
              </li>
            ))}
          </ol>
        </div>
      </SettingsCard>
    </div>
  );
}
