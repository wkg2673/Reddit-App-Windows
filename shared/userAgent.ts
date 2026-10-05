/**
 * The user agent presented to reddit.com.
 *
 * Chromium's default agent carries an `Electron/<version>` token, which a
 * handful of Reddit endpoints reject. Presenting the plain Chrome agent keeps
 * the site behaving exactly as it does in a browser.
 */
export function chromeUserAgent(chromeVersion: string = currentChromeVersion()): string {
  const major = /(\d+)/.exec(chromeVersion ?? '')?.[1] ?? '130';
  return (
    `Mozilla/5.0 (${osPlatformToken()}) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${major}.0.0.0 Safari/537.36`
  );
}

function currentChromeVersion(): string {
  const versions = (globalThis as { process?: { versions?: { chrome?: string } } }).process?.versions;
  return versions?.chrome ?? '130';
}

function osPlatformToken(): string {
  const platform = (globalThis as { process?: { platform?: string } }).process?.platform;
  if (platform === 'win32') return 'Windows NT 10.0; Win64; x64';
  if (platform === 'darwin') return 'Macintosh; Intel Mac OS X 10_15_7';
  return 'X11; Linux x86_64';
}
