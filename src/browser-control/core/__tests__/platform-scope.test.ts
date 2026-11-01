import { describe, expect, it, vi } from 'vitest';
import { allows, normalizePolicy, scopeRoot, scopedDialog, withinRoots } from '../url-policy';
import { captureTier1, frameAllowed } from '../perception/capture';
import type { CdpPort, FrameRecord, TopologyPort } from '../ports';

describe('platform scope', () => {
  const root = 'http://127.0.0.1:3001/construct';
  it.each([
    ['http://127.0.0.1:3001/construct', true],
    ['http://127.0.0.1:3001/construct/expert-whitelist?x=1#row', true],
    ['http://127.0.0.1:3001/construction', false],
    ['http://127.0.0.1:3001/construct/../private', false],
    ['http://127.0.0.1:3001/construct/%2e%2e/private', false],
    ['http://127.0.0.1:3001/construct/%2fprivate', false],
    ['http://127.0.0.1:3001/construct/%252e%252e%252fprivate', false],
    ['http://127.0.0.1:5670/construct', false],
    ['http://localhost:3001/construct', false],
    ['https://127.0.0.1:3001/construct', false],
    ['https://baidu.com/construct', false],
    ['http://127.0.0.1.evil.test:3001/construct', false],
    ['http://user@127.0.0.1:3001/construct', false],
    ['about:blank', false],
  ])('matches exact origin and path boundary: %s', (url, expected) => {
    expect(withinRoots(url, [root])).toBe(expected);
  });
  it('treats empty configured scope as deny-all and preserves path case', () => {
    expect(allows({ allow: [], deny: [], roots: [] }, root)).toBe(false);
    expect(normalizePolicy({ allow: [], deny: [], roots: ['https://EXAMPLE.test/Team/'] }).roots).toEqual([
      'https://example.test/Team',
    ]);
    expect(withinRoots('https://example.test/team', ['https://example.test/Team'])).toBe(false);
    expect(withinRoots('http://127.0.0.1:3001/anything', ['http://127.0.0.1:3001/'])).toBe(true);
    expect(() => scopeRoot('https://example.test/a?secret=1')).toThrow();
  });
  it('never requests forbidden frame content or renderer-wide DOM snapshots', async () => {
    const frames: FrameRecord[] = [
      {
        frameId: 'main',
        parentFrameId: undefined,
        sessionId: undefined,
        loaderId: '1',
        url: root,
        depth: 0,
        adFrame: false,
      },
      {
        frameId: 'outside',
        parentFrameId: 'main',
        sessionId: undefined,
        loaderId: '2',
        url: 'http://127.0.0.1:3001/private',
        depth: 1,
        adFrame: false,
      },
    ];
    const send = vi.fn(async (_session, method) => {
      if (method === 'Accessibility.getFullAXTree') return { nodes: [] };
      if (method === 'Page.getLayoutMetrics') return { cssLayoutViewport: {}, cssContentSize: { width: 1, height: 1 } };
      return {};
    });
    const capture = await captureTier1(
      1,
      { send } as unknown as CdpPort,
      { frames: async () => frames } as TopologyPort,
      { enabledSessions: new Set() },
      { allow: [], deny: [], roots: [root] },
    );
    expect(capture.frames[1].status).toBe('skipped');
    const ax = send.mock.calls.filter(([, method]) => method === 'Accessibility.getFullAXTree');
    expect(ax).toHaveLength(1);
    expect(send.mock.calls.some(([, method]) => method === 'DOMSnapshot.captureSnapshot')).toBe(false);
    expect(frameAllowed({ ...frames[1], url: 'about:srcdoc' }, frames, { allow: [], deny: [], roots: [root] })).toBe(
      true,
    );
  });
  it('does not expose free text or prompt defaults from an outside dialog', () => {
    const dialog = { url: 'https://outside.test/', message: 'outside-secret', defaultPrompt: 'secret-default' };
    const filtered = scopedDialog(dialog, { allow: [], deny: [], roots: [root] });
    expect(filtered.message).not.toContain('outside-secret');
    expect(filtered.defaultPrompt).toBeUndefined();
    expect(scopedDialog({ ...dialog, url: root }, { allow: [], deny: [], roots: [root] }).message).toBe(
      'outside-secret',
    );
  });
});
