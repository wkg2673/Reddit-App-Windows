import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ExternalLinkOpener } from '../electron/externalLinks';
import { JsonStore } from '../electron/store';

describe('ExternalLinkOpener', () => {
  it('opens external URLs exactly once within the debounce window', async () => {
    const opened: string[] = [];
    let now = 1_000;
    const opener = new ExternalLinkOpener((url) => opened.push(url), 1_500, () => now);

    expect(await opener.openUrl('https://example.com/a')).toBe(true);
    expect(await opener.openUrl('https://example.com/a')).toBe(false);
    expect(opened).toEqual(['https://example.com/a']);

    now = 2_600;
    expect(await opener.openUrl('https://example.com/a')).toBe(true);
    expect(opened).toHaveLength(2);
  });

  it('opens the same URL again once the window has passed', async () => {
    const opened: string[] = [];
    let now = 0;
    const opener = new ExternalLinkOpener((url) => opened.push(url), 100, () => now);

    await opener.openUrl('https://example.com/b');
    now = 50;
    await opener.openUrl('https://example.com/b');
    now = 500;
    await opener.openUrl('https://example.com/b');

    expect(opened).toHaveLength(2);
  });

  it('refuses to open in-app and blocked URLs', async () => {
    const opened: string[] = [];
    const opener = new ExternalLinkOpener((url) => opened.push(url));

    expect(await opener.openUrl('https://www.reddit.com/r/pics')).toBe(false);
    expect(await opener.openUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false);
    expect(await opener.openUrl('javascript:alert(1)')).toBe(false);
    expect(opened).toEqual([]);
  });

  it('reports failure without throwing', async () => {
    const opener = new ExternalLinkOpener(() => {
      throw new Error('no handler registered');
    });
    await expect(opener.openUrl('https://example.com/c')).resolves.toBe(false);
  });
});

describe('JsonStore', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reddit-desktop-store-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when the file is missing or corrupt', () => {
    const store = new JsonStore<{ a: number }>('state.json', dir);
    expect(store.read()).toBeNull();
    writeFileSync(join(dir, 'state.json'), '{ not json', 'utf8');
    expect(new JsonStore<{ a: number }>('state.json', dir).read()).toBeNull();
  });

  it('merges patches and writes atomically', () => {
    const store = new JsonStore<{ width: number; height: number }>('state.json', dir);
    store.patch({ width: 900 });
    store.patch({ height: 700 });
    store.flush();

    const raw = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
    expect(raw).toEqual({ width: 900, height: 700 });
    expect(readdirSync(dir)).toEqual(['state.json']);
  });

  it('round-trips through a new instance', () => {
    const first = new JsonStore<{ value: string }>('state.json', dir);
    first.patch({ value: 'reddit' });
    first.flush();
    expect(new JsonStore<{ value: string }>('state.json', dir).read()).toEqual({ value: 'reddit' });
  });
});
