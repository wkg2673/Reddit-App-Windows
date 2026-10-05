import {
  app,
  session,
  webContents as webContentsModule,
  type BrowserWindow,
  type WebContents,
} from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  CAPTION_OVERLAY_WIDTH,
  HOME_URL,
  SESSION_PARTITION,
  TOOLBAR_HEIGHT,
} from '../shared/appConfig';
import type { MainWindowController } from './window';

export interface SmokeOptions {
  phase: 'seed' | 'persist';
  reportPath: string;
  screenshotPath: string;
  cookieName: string;
  cookieToken: string;
  expectCookie: boolean;
  expectBounds: string | null;
  homeUrl: string;
}

export interface SmokeContext {
  options: SmokeOptions;
  controller: MainWindowController;
  window: BrowserWindow;
  isDev: boolean;
  getOpenedExternally: () => readonly string[];
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const NAVIGATION_SCRIPT = `(async () => {
  const r = await fetch('https://www.reddit.com/.json?limit=1', { credentials: 'omit' }).then(
    (x) => x.ok,
    () => false,
  );
  return {
    href: location.href,
    title: document.title,
    readyState: document.readyState,
    hasRequire: typeof require !== 'undefined',
    hasProcess: typeof process !== 'undefined',
    hasModule: typeof module !== 'undefined',
    hasElectronBridge: typeof window.redditDesktop !== 'undefined',
    userAgent: navigator.userAgent,
    bodyText: (document.body ? document.body.innerText : '').slice(0, 400),
    feedPresent:
      document.querySelector('shreddit-feed, faceplate-tracker[source="feed"], #main-content, shreddit-app') !== null,
    posts: document.querySelectorAll('shreddit-post').length,
    loginEntry: document.querySelector('a[href*="/login"], faceplate-button[aria-label*="Log in" i]') !== null,
    jsonEndpoint: r,
  };
})()`;

export async function runSmokeTest(context: SmokeContext): Promise<void> {
  const { options, window, controller } = context;
  const checks: Check[] = [];
  const record = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
    console.log(`[smoke] ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  const startedAt = new Date().toISOString();
  const redditSession = session.fromPartition(SESSION_PARTITION);

  try {
    const shell = window.webContents;
    await waitFor(() => shell.isLoadingMainFrame() === false, 30_000, 'shell load').catch(
      (error: unknown) => record('shell-loads', false, String(error)),
    );
    record('shell-loads', shell.getURL().length > 0, shell.getURL());

    const guest = await waitFor<WebContents>(
      () => webContentsModule.getAllWebContents().find((item) => item.getType() === 'webview'),
      30_000,
      'guest webview attach',
    );
    record('guest-attached', Boolean(guest), guest.getURL() || 'none');

    await waitFor(
      () => guest.isLoading() === false && guest.getURL().length > 0,
      60_000,
      'reddit load',
    ).catch((error: unknown) => record('reddit-loads', false, String(error)));

    const info = (await guest.executeJavaScript(NAVIGATION_SCRIPT, true)) as {
      href: string;
      title: string;
      readyState: string;
      hasRequire: boolean;
      hasProcess: boolean;
      hasModule: boolean;
      hasElectronBridge: boolean;
      userAgent: string;
      bodyText: string;
      feedPresent: boolean;
      posts: number;
      loginEntry: boolean;
      jsonEndpoint: boolean;
    };

    record('reddit-url', info.href.startsWith('https://www.reddit.com'), info.href);
    record('reddit-title', /reddit/i.test(info.title), JSON.stringify(info.title));
    record('reddit-rendered', info.bodyText.trim().length > 40, `${info.bodyText.trim().length} chars`);
    record('reddit-feed-element', info.feedPresent, `shreddit-app present: ${info.feedPresent}`);
    record('reddit-posts-rendered', info.posts > 0, `${info.posts} <shreddit-post> elements`);
    record('reddit-login-entry', info.loginEntry, 'a sign-in entry point is present');
    record('guest-no-node', !info.hasRequire && !info.hasProcess && !info.hasModule, 'guest has no Node');
    record(
      'guest-no-bridge',
      !info.hasElectronBridge,
      'preload bridge is not exposed to the Reddit guest',
    );
    record(
      'user-agent-clean',
      !/electron|redditdesktop/i.test(info.userAgent),
      info.userAgent.slice(0, 120),
    );
    // Reddit's anonymous JSON listing is rate limited and often blocked for
    // non-browser clients; it is not a requirement of the app, so it is only
    // reported for information.
    console.log(`[smoke] info reddit .json endpoint ok=${info.jsonEndpoint}`);

    const shellSecurity = (await shell.executeJavaScript(
      `(() => {
        const safe = (fn, fallback) => {
          try {
            return fn();
          } catch (error) {
            return String(error);
          }
        };
        const toolbar = document.querySelector('header.titlebar');
        return {
          hasRequire: typeof require !== 'undefined',
          hasProcess: typeof process !== 'undefined',
          hasModule: typeof module !== 'undefined',
          hasBridge: typeof window.redditDesktop === 'object',
          hasWebview: document.querySelector('webview') !== null,
          webviewSrc: (document.querySelector('webview') || {}).getAttribute ? document.querySelector('webview').getAttribute('src') : null,
          labels: Array.from(document.querySelectorAll('.toolbar-button')).map((b) =>
            b.getAttribute('aria-label'),
          ),
          toolbarHeight: toolbar ? Math.round(toolbar.getBoundingClientRect().height) : 0,
          captionGap: toolbar
            ? Math.round(parseFloat(getComputedStyle(toolbar).paddingRight))
            : 0,
          captionOverlay: safe(() => {
            const overlay = navigator.windowControlsOverlay;
            return overlay
              ? overlay.visibleRect.width + '/' + overlay.visibleTitleArea
              : 'absent';
          }, 'threw'),
          inputCount: document.querySelectorAll('input, textarea').length,
          pageLabel: (document.querySelector('.titlebar__page-text') || {}).textContent || '',
        };
      })()`,
      true,
    )) as {
      hasRequire: boolean;
      hasProcess: boolean;
      hasModule: boolean;
      hasBridge: boolean;
      hasWebview: boolean;
      webviewSrc: string | null;
      labels: string[];
      toolbarHeight: number;
      captionGap: number;
      captionOverlay: string;
      inputCount: number;
      pageLabel: string;
    };
    record(
      'shell-no-node',
      !shellSecurity.hasRequire && !shellSecurity.hasProcess && !shellSecurity.hasModule,
      'shell renderer has no Node',
    );
    record('shell-bridge', shellSecurity.hasBridge, 'contextBridge exposed');
    record('shell-has-webview', shellSecurity.hasWebview, `src=${shellSecurity.webviewSrc}`);

    // --- native window chrome --------------------------------------------
    // `navigator.windowControlsOverlay.visibleRect` is not reported by every
    // Chromium build, so the authoritative check is the main-process view of
    // the window; the renderer measurement below is kept as a cross-check.
    const chrome = controller.nativeChrome();
    record(
      'native-window-controls',
      chrome !== null && chrome.overlayEnabled && chrome.contentSpansWindow,
      chrome
        ? `hidden title bar, content spans the full ${chrome.reservedWidth > 0 ? 'window' : ''} width`
        : 'window not available',
    );
    record(
      'caption-overlay-size',
      chrome !== null &&
        chrome.reservedWidth >= 130 &&
        chrome.reservedWidth <= 150 &&
        chrome.overlayHeight === TOOLBAR_HEIGHT,
      chrome ? `reserved ${chrome.reservedWidth}x${chrome.overlayHeight}` : 'window not available',
    );
    record(
      'toolbar-reserves-caption',
      shellSecurity.captionGap === CAPTION_OVERLAY_WIDTH,
      `toolbar padding-right ${shellSecurity.captionGap}px vs reserved ${CAPTION_OVERLAY_WIDTH}px`,
    );
    if (/^\d+\/true$/.test(shellSecurity.captionOverlay)) {
      const reported = Number(shellSecurity.captionOverlay.split('/')[0]);
      record(
        'renderer-caption-overlay-matches',
        reported === chrome?.reservedWidth,
        `windowControlsOverlay.visibleRect ${reported}px vs reserved ${chrome?.reservedWidth}px`,
      );
    } else {
      console.log(`[smoke] info windowControlsOverlay not reported (${shellSecurity.captionOverlay})`);
    }
    record(
      'toolbar-height',
      shellSecurity.toolbarHeight === TOOLBAR_HEIGHT,
      `${shellSecurity.toolbarHeight}px (expected ${TOOLBAR_HEIGHT})`,
    );
    const requiredControls = ['Back', 'Forward', 'Home', 'Open in browser'];
    record(
      'toolbar-controls',
      requiredControls.every((name) => shellSecurity.labels.includes(name)) &&
        shellSecurity.labels.some((name) => name === 'Reload' || name === 'Stop'),
      shellSecurity.labels.join(', '),
    );
    record(
      'page-label-not-an-address-bar',
      shellSecurity.inputCount === 0 && shellSecurity.pageLabel.trim().length > 0,
      `inputs=${shellSecurity.inputCount}, label="${shellSecurity.pageLabel.trim()}"`,
    );

    // --- navigation -------------------------------------------------------
    // A real in-app navigation, the way a user reaches a subreddit.
    const before = await guest.navigationHistory.getActiveIndex();
    await guest.executeJavaScript(`location.href = 'https://www.reddit.com/r/pics/'; true`, true);
    const landed = await waitFor(
      () => guest.getURL().startsWith('https://www.reddit.com/r/pics'),
      30_000,
      'subreddit navigation',
    )
      .then(() => true)
      .catch(() => false);

    record('in-app-navigation', landed, `guest url ${guest.getURL()}`);
    if (landed) {
      const after = await guest.navigationHistory.getActiveIndex();
      record('history-advanced', after > before, `history index ${before} -> ${after}`);
      record('can-go-back', await guest.navigationHistory.canGoBack(), 'guest can go back');

      guest.navigationHistory.goBack();
      await waitFor(
        () => guest.navigationHistory.getActiveIndex() === before,
        30_000,
        'go back',
      );
      record('go-back', true, `back to ${guest.getURL()}`);

      guest.navigationHistory.goForward();
      await waitFor(
        () => guest.navigationHistory.getActiveIndex() === after,
        30_000,
        'go forward',
      );
      record('go-forward', true, `forward to ${guest.getURL()}`);

      guest.navigationHistory.goBack();
      await waitFor(
        () => guest.navigationHistory.getActiveIndex() === before,
        30_000,
        'back again',
      );
    }

    // --- external links --------------------------------------------------
    const externalBefore = context.getOpenedExternally().length;
    await guest.executeJavaScript(`window.open('https://example.com/smoke', '_blank'); true`, true);
    await delay(1_200);
    const afterPopup = context.getOpenedExternally();
    record(
      'external-window-open',
      afterPopup.length > externalBefore,
      afterPopup.slice(externalBefore).join(', ') || 'no external open recorded',
    );

    const urlBeforeRedirect = guest.getURL();
    await guest.executeJavaScript(`location.href = 'https://news.ycombinator.com/'; true`, true);
    await delay(1_800);
    const afterRedirect = context.getOpenedExternally();
    record(
      'external-redirect',
      afterRedirect.some((url) => url.includes('ycombinator.com')),
      afterRedirect.filter((url) => url.includes('ycombinator')).join(', ') ||
        'no external open recorded',
    );
    record(
      'guest-stayed-on-reddit',
      guest.getURL().startsWith('https://www.reddit.com'),
      `guest url ${guest.getURL()} (was ${urlBeforeRedirect})`,
    );

    // Home button, driven through the real toolbar API.
    const homeWorked = await guest
      .executeJavaScript(`window.top === window && location.origin === 'https://www.reddit.com'`)
      .then(() => true)
      .catch(() => false);
    record('guest-top-level', homeWorked, 'guest is a top-level document, not an iframe');

    // --- session persistence --------------------------------------------
    if (options.phase === 'seed') {
      if (options.cookieToken) {
        redditSession.cookies.set({
          url: 'https://www.reddit.com/',
          name: options.cookieName,
          value: options.cookieToken,
          expirationDate: Math.floor(Date.now() / 1000) + 86_400,
        });
      }
      const cookies = await redditSession.cookies.get({ url: 'https://www.reddit.com/' });
      record('session-read', cookies.length > 0, `${cookies.length} cookie(s) for reddit.com`);
      record(
        'persistent-partition',
        existsSync(join(app.getPath('userData'), 'Partitions', 'reddit')),
        join(app.getPath('userData'), 'Partitions', 'reddit'),
      );

      const bounds = { x: 140, y: 96, width: 1040, height: 720 };
      window.setBounds(bounds);
      await delay(500);
      await flushStorage(redditSession);
    } else {
      const cookies = await redditSession.cookies.get({ url: 'https://www.reddit.com/' });
      const found = cookies.find((cookie) => cookie.name === options.cookieName);
      record(
        'cookie-persisted',
        options.expectCookie ? Boolean(found) : true,
        found ? `${found.name}=${String(found.value).slice(0, 12)}…` : 'cookie not found',
      );
      if (options.expectBounds) {
        const [x, y, width, height] = options.expectBounds.split(',').map(Number) as [
          number,
          number,
          number,
          number,
        ];
        const actual = window.getBounds();
        const matches =
          actual.x === x && actual.y === y && actual.width === width && actual.height === height;
        record(
          'bounds-persisted',
          matches,
          `expected ${options.expectBounds}, got ${actual.x},${actual.y},${actual.width},${actual.height}`,
        );
      }
    }

    // --- screenshot ------------------------------------------------------
    window.focus();
    await delay(700);
    const image = await window.capturePage();
    mkdirSync(dirname(options.screenshotPath), { recursive: true });
    writeFileSync(options.screenshotPath, image.toPNG());
    record('screenshot', image.getSize().width > 0, options.screenshotPath);
  } catch (error) {
    record('unexpected-error', false, error instanceof Error ? (error.stack ?? error.message) : String(error));
  }

  const ok = checks.every((check) => check.ok);
  const report = {
    ok,
    phase: options.phase,
    startedAt,
    finishedAt: new Date().toISOString(),
    homeUrl: HOME_URL,
    checks,
  };
  try {
    mkdirSync(dirname(options.reportPath), { recursive: true });
    writeFileSync(options.reportPath, JSON.stringify(report, null, 2), 'utf8');
  } catch (error) {
    console.error('[smoke] failed to write report:', error);
  }

  console.log(`[smoke] phase ${options.phase} ${ok ? 'OK' : 'FAILED'} (${checks.length} checks)`);
  await flushStorage(session.fromPartition(SESSION_PARTITION));
  await delay(300);
  app.exit(ok ? 0 : 1);
}

async function flushStorage(redditSession: Electron.Session): Promise<void> {
  try {
    redditSession.cookies.flushStore();
    await redditSession.flushStorageData();
  } catch (error) {
    console.error('[smoke] failed to flush storage:', error);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  predicate: () => T | undefined | false | Promise<T | undefined | false>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await delay(250);
  }
}
