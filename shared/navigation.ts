/**
 * Decides where a URL belongs: inside the app (a Reddit page) or in the user's
 * default browser (everything else).
 *
 * Kept dependency-free and side-effect free so it can be unit tested and shared
 * by the main process, the guest guards and the renderer.
 */

/**
 * Registrable domains that are part of the Reddit experience. Everything that
 * is not covered here is handed to the operating system.
 */
export const IN_APP_DOMAINS: readonly string[] = [
  'reddit.com', // www, old, new, np, sh, i, amp, oauth, accounts, out, gateway
  'redd.it', // short links, i.redd.it / v.redd.it / preview.redd.it media
  'redditmedia.com', // thumbnails, avatars, stylesheets
];

/**
 * Identity providers. Reddit's "continue with Google/Apple" flow leaves
 * reddit.com; if we bounced those to the default browser the session cookie
 * would be written to the browser's cookie jar and the app would never become
 * logged in, so these are allowed to render in-app (they are top-level
 * navigations only and are still served over verified TLS).
 */
export const AUTH_DOMAINS: readonly string[] = [
  'accounts.google.com',
  'appleid.apple.com',
  'login.live.com',
  'login.microsoftonline.com',
];

/** Schemes we are willing to hand to the operating system. */
const EXTERNAL_SCHEMES: readonly string[] = ['mailto:', 'tel:'];

const WEB_SCHEMES: readonly string[] = ['http:', 'https:'];

const HOME_ORIGIN = 'https://www.reddit.com';

export type NavigationDecision =
  | { kind: 'in-app'; url: string; isAuthFlow: boolean }
  | { kind: 'external'; url: string }
  | { kind: 'blocked'; reason: string };

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost')
  );
}

/**
 * Classifies a raw (possibly relative, possibly hostile) URL string.
 *
 * Never throws: unparseable input is reported as `blocked`.
 */
export function classifyUrl(raw: string): NavigationDecision {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { kind: 'blocked', reason: 'empty-url' };
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { kind: 'blocked', reason: 'empty-url' };
  }

  // Relative URLs are resolved against the site itself and always in-app.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return { kind: 'in-app', url: trimmed, isAuthFlow: false };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { kind: 'blocked', reason: 'unparseable-url' };
  }

  const protocol = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();

  if (EXTERNAL_SCHEMES.includes(protocol)) {
    return { kind: 'external', url: parsed.toString() };
  }

  if (!WEB_SCHEMES.includes(protocol)) {
    // file:, javascript:, data:, blob:, custom app schemes, ...
    return { kind: 'blocked', reason: `scheme-not-allowed:${protocol}` };
  }

  if (host.length === 0) {
    return { kind: 'blocked', reason: 'missing-host' };
  }

  // Never bounce a dev server or the local shell out to the OS.
  if (isLocalHost(host)) {
    return { kind: 'blocked', reason: 'local-host' };
  }

  if (IN_APP_DOMAINS.some((domain) => hostMatches(host, domain))) {
    return { kind: 'in-app', url: parsed.toString(), isAuthFlow: false };
  }

  if (AUTH_DOMAINS.some((domain) => hostMatches(host, domain))) {
    return { kind: 'in-app', url: parsed.toString(), isAuthFlow: true };
  }

  return { kind: 'external', url: parsed.toString() };
}

/** Convenience predicate used by the guard handlers. */
export function isInAppUrl(raw: string): boolean {
  return classifyUrl(raw).kind === 'in-app';
}

/** Human readable label for the window title / toolbar subtitle. */
export function describeUrl(raw: string): string {
  const decision = classifyUrl(raw);
  if (decision.kind === 'blocked') return '';
  try {
    const { hostname, pathname } = new URL(decision.url, HOME_ORIGIN);
    const path = pathname === '/' ? '' : pathname.replace(/\/$/, '');
    return `${hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return '';
  }
}
