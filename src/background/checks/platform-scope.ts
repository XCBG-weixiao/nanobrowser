import { platformCredentials, platformStorage, platformHealth } from '@src/store/platform';
import { pollNotifications } from '@src/extension/platform';
import { FIXTURE_ORIGIN, FIXTURE_CROSS_ORIGIN } from '../fixtures-config';
import { layer } from '../layer';
import { assert, evaluate, sleep, withTab, waitForLoad } from './helpers';
import { defineCheck } from './registry';
import { panel, scriptReplies, seedFixtureModel, waitForText } from './panel-chat';

defineCheck({
  name: 'platform-scope',
  title: 'Platform URL, frame and screenshot scope',
  description:
    'Only the exact platform origin and path are read or controlled. Forbidden frames are not captured; mixed-page screenshots and keyboard input fail explicitly.',
  async run() {
    const { controller } = await layer();
    const root = `${FIXTURE_ORIGIN}/platform-scope.html`;
    const session = controller.createSession({ urlPolicy: { allow: [], deny: [], roots: [root] }, confirm: 'never' });
    try {
      return await withTab(root, async tab => {
        await waitForLoad(tab.tabId);
        await session.share(tab.tabId);
        await sleep(300);
        const snapshot = await session.call('snapshot', { tabId: tab.tabId });
        assert(snapshot.ok, snapshot.text);
        assert(snapshot.page?.snapshot?.includes('Authorized platform'), 'allowed document was read');
        assert(
          !JSON.stringify(snapshot).includes('FORBIDDEN_FRAME_CONTENT_72851'),
          'forbidden content must never be returned',
        );
        const screenshot = await session.call('screenshot', { tabId: tab.tabId });
        assert(screenshot.error?.code === 'URL_NOT_ALLOWED', 'mixed-frame screenshots must be refused');
        const type = await session.call('set', {
          tabId: tab.tabId,
          target: { role: 'textbox', name: 'Allowed input' },
          value: 'synthetic',
        });
        assert(type.error?.code === 'URL_NOT_ALLOWED', `mixed-frame keyboard input: ${type.text}`);
        const wheel = await session.call('scroll', { tabId: tab.tabId, by: { pages: 1 } });
        assert(
          wheel.error?.code === 'URL_NOT_ALLOWED',
          'mixed-frame wheel scrolling must not control a forbidden frame',
        );
        const click = await session.call('click', {
          target: { role: 'button', name: 'Read allowed result' },
          tabId: tab.tabId,
        });
        assert(click.ok, click.text);
        const after = await session.call('snapshot', { tabId: tab.tabId });
        assert(after.page?.snapshot?.includes('Clicked authorized button'), 'authorized button works');
        await evaluate(
          tab.tabId,
          undefined,
          "document.querySelector('iframe').contentWindow.postMessage('test-dialog', '*')",
        );
        await sleep(150);
        const blockedDialog = await session.call('snapshot', { tabId: tab.tabId });
        assert(
          !JSON.stringify(blockedDialog).includes('FORBIDDEN_DIALOG_CONTENT_72851'),
          'outside dialog text is not returned',
        );
        const dismiss = await session.call('handle_dialog', { tabId: tab.tabId, accept: false });
        assert(dismiss.error?.code === 'URL_NOT_ALLOWED', 'outside dialog may only be handled by the user');
        await controller
          .tabState(tab.tabId)
          .attachment!.cdp.send(undefined, 'Page.handleJavaScriptDialog', { accept: false });
        const sibling = await session.call('navigate', {
          tabId: tab.tabId,
          url: `${FIXTURE_ORIGIN}/platform-scope-outside.html`,
        });
        assert(sibling.error?.code === 'URL_NOT_ALLOWED', 'same-origin sibling path denied');
        const outside = await session.call('tabs', {
          action: 'open',
          url: `${FIXTURE_CROSS_ORIGIN}/platform-scope-outside.html`,
        });
        assert(outside.error?.code === 'URL_NOT_ALLOWED', 'other origin denied');
        await session.setUrlPolicy({ allow: [], deny: [], roots: [FIXTURE_ORIGIN + '/'] });
        const redirect = await session.call('navigate', {
          tabId: tab.tabId,
          url: `${FIXTURE_ORIGIN}/redirect?to=${encodeURIComponent(FIXTURE_CROSS_ORIGIN + '/network-landed.html')}`,
        });
        assert(redirect.error?.code === 'URL_NOT_ALLOWED', 'redirect hop denied');
        return {
          allowedRead: true,
          forbiddenFramesExcluded: true,
          mixedScreenshotDenied: true,
          mixedKeyboardDenied: true,
          authorizedClick: true,
          pathDenied: true,
          originDenied: true,
          redirectDenied: true,
        };
      });
    } finally {
      await controller.closeSession(session);
    }
  },
});

defineCheck({
  name: 'platform-notifications',
  title: 'Desktop notification delivery and server acknowledgement',
  description:
    'Uses only a synthetic authenticated fixture endpoint, creates a real Chrome notification and acknowledges it once. Also renders the platform options UI.',
  async run() {
    const oldConfig = await platformStorage.get();
    const oldCredentials = await platformCredentials.get();
    await fetch(`${FIXTURE_ORIGIN}/__platform/reset`, { method: 'POST' });
    try {
      await platformStorage.set({ pageRoot: FIXTURE_ORIGIN + '/', apiBaseUrl: FIXTURE_ORIGIN + '/__platform' });
      await platformCredentials.set({ userId: 'fixture-admin', token: 'synthetic-session' });
      await pollNotifications();
      assert(!(await platformHealth.get()).error, `notification health: ${JSON.stringify(await platformHealth.get())}`);
      const shown = await chrome.notifications.getAll();
      assert('nb-whitelist:fixture-approval' in shown, 'Chrome created the desktop notification');
      const result = await (await fetch(`${FIXTURE_ORIGIN}/__platform/state`)).json();
      assert(result.acknowledgements === 1, 'server acknowledged notification once');
      await pollNotifications();
      const repeated = await (await fetch(`${FIXTURE_ORIGIN}/__platform/state`)).json();
      assert(repeated.acknowledgements === 1, 'no repeated ack or approval');
      const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('/options.html#platform'), active: false });
      try {
        await waitForLoad(tab.id!);
        await sleep(400);
        const ui = await chrome.runtime.sendMessage({ nbTest: 'options', op: 'read' });
        assert(ui.body.includes('平台访问范围') && ui.body.includes('白名单自动审批'), 'platform settings rendered');
      } finally {
        await chrome.tabs.remove(tab.id!);
      }
      return { desktopNotificationCreated: true, acknowledgedOnce: true, optionsRendered: true };
    } finally {
      await chrome.notifications.clear('nb-whitelist:fixture-approval');
      await platformCredentials.set(oldCredentials);
      await platformStorage.set(oldConfig);
    }
  },
});

defineCheck({
  name: 'platform-chat',
  title: 'Business tools and one-time watcher confirmation',
  description:
    'The actual agent loop reads business state, asks before enabling, and only changes the synthetic server after the user confirms in the panel.',
  async run() {
    const oldConfig = await platformStorage.get();
    const oldCredentials = await platformCredentials.get();
    await seedFixtureModel();
    await fetch(`${FIXTURE_ORIGIN}/__platform/reset`, { method: 'POST' });
    await platformStorage.set({ pageRoot: FIXTURE_ORIGIN + '/', apiBaseUrl: FIXTURE_ORIGIN + '/__platform' });
    await platformCredentials.set({ userId: 'fixture-admin', token: 'synthetic-session' });
    await scriptReplies([
      { toolCalls: [{ name: 'get_whitelist_watch_status', input: {} }] },
      { toolCalls: [{ name: 'set_whitelist_watch_state', input: { enabled: true } }] },
      { toolCalls: [{ name: 'done', input: { outcome: 'success', summary: 'Synthetic whitelist watcher enabled.' } }] },
    ]);
    const page = await chrome.tabs.create({ url: `${FIXTURE_ORIGIN}/network-landed.html`, active: false });
    await waitForLoad(page.id!);
    const tab = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/sidepanel.html#tab=${page.id}`),
      active: true,
    });
    await waitForLoad(tab.id!);
    await sleep(500);
    try {
      await panel(page.id!, 'type-send', { text: '开启白名单自动审批，已有和新增全部通过。' });
      let body = '';
      for (let i = 0; i < 60; i++) {
        body = (await panel(page.id!, 'read')).body;
        if (body.includes('白名单自动审批授权')) break;
        await sleep(150);
      }
      assert(body.includes('已有和新增的待审批申请将全部自动同意'), `authorization card: ${body}`);
      const before = await (await fetch(`${FIXTURE_ORIGIN}/__platform/state`)).json();
      assert(before.enabled === false, 'server task is not enabled before the user confirms');
      await panel(page.id!, 'click', { label: '启用自动审批' });
      await waitForText(page.id!, 'Synthetic whitelist watcher enabled.');
      const after = await (await fetch(`${FIXTURE_ORIGIN}/__platform/state`)).json();
      assert(after.enabled === true, 'confirmation enabled the synthetic server task');
      const requests = await (await fetch(`${FIXTURE_ORIGIN}/__llm/requests`)).json();
      assert(!JSON.stringify(requests).includes('synthetic-session'), 'platform token must never reach the model');
      return {
        businessToolsExecuted: true,
        confirmationRequired: true,
        enabledAfterConfirmation: true,
        credentialsExcludedFromModel: true,
      };
    } finally {
      await chrome.tabs.remove(tab.id!);
      await chrome.tabs.remove(page.id!);
      await platformCredentials.set(oldCredentials);
      await platformStorage.set(oldConfig);
    }
  },
});
