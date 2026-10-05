import { app, BrowserWindow, dialog, nativeTheme, protocol, session, shell } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

import {
  APP_ID,
  APP_NAME,
  APP_SCHEME,
  APP_SWITCHES,
  HOME_URL,
  SESSION_PARTITION,
} from '../shared/appConfig';
import { ExternalLinkOpener } from './externalLinks';
import {
  guardGuestContents,
  guardGuestSession,
  guardShellContents,
  hardenSession,
} from './security';
import { runSmokeTest, type SmokeOptions } from './smokeTest';
import { MainWindowController } from './window';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
const RENDERER_DIR = join(__dirname, '..', 'renderer');
const PRELOAD = join(__dirname, 'preload.cjs');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const smoke: SmokeOptions | null = parseSmokeOptions(process.argv, process.env);

/**
 * Development mode is opt-in through the environment. `npm run dev` sets it so
 * the shell loads from the Vite dev server; every other path - including
 * `electron .` after a build and the packaged app - uses the production
 * `app://` shell, so the smoke test exercises the real thing.
 */
const isDev = process.env.REDDIT_DESKTOP_DEV === '1';

/** DevTools are useful while hacking on an unpackaged build, but never shipped. */
const allowDevTools = isDev || !app.isPackaged;

const openedExternally: string[] = [];
const opener = new ExternalLinkOpener(async (url) => {
  if (smoke) {
    openedExternally.push(url);
    console.log(`[smoke] external-open ${url}`);
    return;
  }
  await shell.openExternal(url);
});

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

// Allows the automated smoke test to run against a throwaway profile so it
// never touches a real installation. Has to happen before userData is read.
const userDataOverride = process.env.REDDIT_DESKTOP_USER_DATA;
if (userDataOverride) app.setPath('userData', userDataOverride);

for (const [name, value] of Object.entries(APP_SWITCHES)) {
  app.commandLine.appendSwitch(name, value);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows();
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

app.on('web-contents-created', (_event, contents) => {
  switch (contents.getType()) {
    case 'webview':
      guardGuestContents(contents, opener);
      break;
    case 'window':
      guardShellContents(contents, shellUrl());
      break;
    case 'browserView':
    case 'remote':
      contents.close();
      break;
    default:
      break;
  }

  if (isDev || smoke) {
    contents.on('console-message', (event) => {
      const level = event.level;
      if (level === 'error' || level === 'warning') {
        console.log(`[${contents.getType()}:${contents.getURL()}] ${level}: ${event.message}`);
      }
    });
  }
});

let controller: MainWindowController | null = null;

app.whenReady().then(async () => {
  await registerShellProtocol();

  // The Reddit session: persistent cookies, hardened.
  const redditSession = session.fromPartition(SESSION_PARTITION);
  hardenSession(redditSession);
  guardGuestSession(redditSession, opener);
  // The shell session: our own UI, every permission denied.
  hardenSession(session.defaultSession);

  nativeTheme.on('updated', () => {
    controller?.sendTheme(nativeTheme.shouldUseDarkColors);
  });

  controller = new MainWindowController(
    app.getPath('userData'),
    PRELOAD,
    shellUrl(),
    {
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      platform: process.platform,
      isDev,
    },
    opener,
    allowDevTools,
  );

  const window = controller.create();

  if (smoke) {
    await runSmokeTest({
      options: smoke,
      controller,
      window,
      isDev,
      getOpenedExternally: () => openedExternally,
    });
    return;
  }

  window.focus();
});

app.on('activate', () => {
  if (!controller) {
    app.whenReady().then(() => controller?.create());
  } else if (!controller.browserWindow || controller.browserWindow.isDestroyed()) {
    controller.create();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

process.on('uncaughtException', (error) => {
  console.error('[main] uncaught exception:', error);
  if (!smoke) {
    dialog.showErrorBox(APP_NAME, String(error?.stack ?? error));
  }
});

function shellUrl(): string {
  return isDev ? DEV_SERVER_URL : `${APP_SCHEME}://bundle/index.html`;
}

async function registerShellProtocol(): Promise<void> {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'bundle') {
      return new Response('not found', { status: 404 });
    }
    const requested = url.pathname === '/' || url.pathname === '' ? '/index.html' : url.pathname;
    const decoded = decodeURIComponent(requested);
    const target = normalize(join(RENDERER_DIR, decoded));
    if (!target.startsWith(RENDERER_DIR + sep)) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const body = await readFile(target);
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': MIME_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
          'cache-control': 'no-cache',
        },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

function parseSmokeOptions(argv: readonly string[], env: NodeJS.ProcessEnv): SmokeOptions | null {
  const flag = argv.includes('--smoke-test') || env.SMOKE_TEST === '1';
  if (!flag) return null;
  const read = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const hit = argv.find((arg) => arg.startsWith(prefix));
    if (hit) return hit.slice(prefix.length);
    return env[`SMOKE_${name.toUpperCase().replace(/-/g, '_')}`];
  };
  return {
    phase: (read('smoke-phase') ?? 'seed') as 'seed' | 'persist',
    reportPath: read('smoke-report') ?? join(app.getPath('temp'), 'reddit-desktop-smoke.json'),
    screenshotPath: read('smoke-screenshot') ?? join(app.getPath('temp'), 'reddit-desktop-smoke.png'),
    cookieName: read('smoke-cookie-name') ?? 'reddit_desktop_smoke',
    cookieToken: read('smoke-cookie-token') ?? '',
    expectCookie: read('smoke-expect-cookie') === '1',
    expectBounds: read('smoke-expect-bounds') ?? null,
    homeUrl: HOME_URL,
  };
}
