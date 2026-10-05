import { describe, expect, it } from 'vitest';

import { HOME_URL, SESSION_PARTITION } from '../shared/appConfig';
import { chromeUserAgent } from '../shared/userAgent';

describe('chromeUserAgent', () => {
  it('does not advertise Electron', () => {
    expect(chromeUserAgent('140.0.7339.41')).not.toMatch(/electron/i);
  });

  it('keeps the bundled Chromium major version so client hints stay consistent', () => {
    const agent = chromeUserAgent('140.0.7339.41');
    expect(agent).toContain('Chrome/140.0.0.0');
    expect(agent).toContain('AppleWebKit/537.36');
  });

  it('falls back to a sane major version when the input is unusable', () => {
    expect(chromeUserAgent('not-a-version')).toContain('Chrome/130.0.0.0');
    expect(chromeUserAgent('')).toContain('Chrome/130.0.0.0');
  });

  it('reports the Electron runtime version without it', () => {
    const agent = chromeUserAgent('142.0.7444.60');
    expect(agent.startsWith('Mozilla/5.0')).toBe(true);
    expect(agent.endsWith('Safari/537.36')).toBe(true);
  });
});

describe('session configuration', () => {
  it('uses a persistent partition so logins survive a restart', () => {
    expect(SESSION_PARTITION.startsWith('persist:')).toBe(true);
  });

  it('points the app at reddit.com over https', () => {
    expect(HOME_URL).toBe('https://www.reddit.com/');
  });
});
