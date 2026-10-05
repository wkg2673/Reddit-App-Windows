import type { Session, WebContents } from 'electron';
import { shell } from 'electron';

import { classifyUrl } from '../shared/navigation';
import { chromeUserAgent } from '../shared/userAgent';
import type { ExternalLinkOpener } from './externalLinks';

/**
 * Permissions a Reddit page may ask for. Everything else is denied: an app
 * that only reads reddit.com has no business touching cameras, geolocation,
 * MIDI, USB serial devices, etc.
 */
/**
 * Permissions a Reddit page may ask for. Everything else is denied: an app
 * that only reads reddit.com has no business touching cameras, geolocation,
 * MIDI, USB serial devices, etc.
 */
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  'notifications',
  'media',
  'fullscreen',
  'clipboard-sanitized-write',
  'clipboard-read',
  'background-sync',
  'idle-detection',
]);

/**
 * Reddit's sign-in flow is gated by a reCAPTCHA frame served from
 * `google.com/recaptcha`, which asks for storage access. It is a storage
 * partitioning API rather than a device capability, and denying it makes
 * logins fail intermittently, so it is granted to that frame only.
 */
const RELAXED_PERMISSIONS: ReadonlySet<string> = new Set(['storage-access']);

function isTrustedRequestor(url: string | undefined): boolean {
  if (!url) return false;
  const decision = classifyUrl(url);
  return decision.kind === 'in-app';
}

/**
 * A plain Chrome user agent.
 *
 * Electron appends `Electron/<version>` to the default UA. A handful of Reddit
 * endpoints (and several CDNs) reject that token, so we present the ordinary
 * Chromium UA instead. No functionality depends on the Electron token.
 */
export { chromeUserAgent } from '../shared/userAgent';

/**
 * Hardens a session: permissions, device access and the user agent.
 *
 * Applied to both the Reddit guest session and the shell session.
 */
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

  // `setUserAgent` is used rather than a `webRequest` header rewrite: only the
  // former updates `navigator.userAgent` inside the guest.
  session.setUserAgent(chromeUserAgent());
}

/**
 * Installs the top level navigation filter for the Reddit guest.
 *
 * `webRequest` allows a single listener per session, so this lives in its own
 * helper and is only ever attached to the guest session - never to the shell,
 * which serves its UI from the `app://` protocol.
 */
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

/** Applies the per-webContents guards to a guest (the Reddit page). */
export function guardGuestContents(contents: WebContents, opener: ExternalLinkOpener): void {
  contents.setWindowOpenHandler(({ url }) => {
    const decision = classifyUrl(url);
    if (decision.kind === 'in-app') {
      // Keep the app single-window: reddit.com targets open in place.
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
    // Nested webviews are never legitimate here.
    event.preventDefault();
  });
}

/**
 * A last line of defence for the shell window: refuse to become a general
 * purpose browser.
 */
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
    // Force a safe configuration no matter what the markup asked for.
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
