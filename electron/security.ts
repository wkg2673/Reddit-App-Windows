import type { Session, WebContents } from 'electron';
import { shell } from 'electron';

import { classifyUrl } from '../shared/navigation';
import { chromeUserAgent } from '../shared/userAgent';
import type { ExternalLinkOpener } from './externalLinks';

const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  'notifications',
  'media',
  'fullscreen',
  'clipboard-sanitized-write',
  'clipboard-read',
  'background-sync',
  'idle-detection',
]);

const RELAXED_PERMISSIONS: ReadonlySet<string> = new Set(['storage-access']);

function isTrustedRequestor(url: string | undefined): boolean {
  if (!url) return false;
  const decision = classifyUrl(url);
  return decision.kind === 'in-app';
}

export { chromeUserAgent } from '../shared/userAgent';

export function hardenSession(session: Session): void {
  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const requesting =
      details.requestingUrl ?? (details as { securityOrigin?: string }).securityOrigin;
    const allowed =
      RELAXED_PERMISSIONS.has(permission) ||
      (ALLOWED_PERMISSIONS.has(permission) && isTrustedRequestor(requesting));
    if (!allowed) {
      console.warn('[security] denied permission:', permission, 'from', requesting ?? 'unknown');
    }
    callback(allowed);
  });

  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return (
      RELAXED_PERMISSIONS.has(permission) ||
      (ALLOWED_PERMISSIONS.has(permission) && isTrustedRequestor(requestingOrigin))
    );
  });

  session.setDevicePermissionHandler(() => false);

  session.setUserAgent(chromeUserAgent());
}

export function guardGuestSession(session: Session, opener: ExternalLinkOpener): void {
  session.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (details.resourceType !== 'mainFrame') {
      callback({ cancel: false });
      return;
    }
    const decision = classifyUrl(details.url);
    if (decision.kind === 'in-app') {
      callback({ cancel: false });
      return;
    }
    if (decision.kind === 'external') {
      void opener.openUrl(details.url);
    }
    callback({ cancel: true });
  });
}

export function guardGuestContents(contents: WebContents, opener: ExternalLinkOpener): void {
  contents.setWindowOpenHandler(({ url }) => {
    const decision = classifyUrl(url);
    if (decision.kind === 'in-app') {
      void contents.loadURL(decision.url).catch((error: unknown) => {
        console.error('[guest] failed to open in-app URL:', decision.url, error);
      });
      return { action: 'deny' };
    }
    if (decision.kind === 'external') {
      void opener.openUrl(decision.url);
    }
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    const decision = classifyUrl(url);
    if (decision.kind === 'in-app') return;
    event.preventDefault();
    if (decision.kind === 'external') {
      void opener.openUrl(url);
    } else {
      console.warn('[guest] blocked navigation:', url, decision.reason);
    }
  });

  contents.on('did-attach-webview', (event) => {
    event.preventDefault();
  });
}

export function guardShellContents(contents: WebContents, allowedOrigin: string): void {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (url.startsWith(allowedOrigin)) return;
    event.preventDefault();
  });

  contents.on('will-attach-webview', (_event, webPreferences, params) => {
    delete webPreferences.preload;
    delete webPreferences.nodeIntegrationInWorker;
    delete webPreferences.nodeIntegrationInSubFrames;
    delete webPreferences.additionalArguments;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.webviewTag = false;
    webPreferences.experimentalFeatures = false;
    if (params.partition && !params.partition.startsWith('persist:')) {
      delete params.partition;
    }
  });

  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame) event.preventDefault();
  });
}
