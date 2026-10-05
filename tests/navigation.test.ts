import { describe, expect, it } from 'vitest';

import { classifyUrl, describeUrl, isInAppUrl } from '../shared/navigation';

describe('classifyUrl', () => {
  it('keeps reddit.com and every subdomain in the app', () => {
    for (const host of [
      'reddit.com',
      'www.reddit.com',
      'old.reddit.com',
      'new.reddit.com',
      'np.reddit.com',
      'sh.reddit.com',
      'i.reddit.com',
      'oauth.reddit.com',
      'accounts.reddit.com',
      'out.reddit.com',
    ]) {
      const decision = classifyUrl(`https://${host}/r/pics/`);
      expect(decision.kind, host).toBe('in-app');
    }
  });

  it('keeps Reddit media hosts in the app', () => {
    for (const url of [
      'https://i.redd.it/abc123.jpg',
      'https://preview.redd.it/abc123.jpg',
      'https://v.redd.it/abc123',
      'https://b.thumbs.redditmedia.com/abc.jpg',
      'https://styles.redditmedia.com/t5/abc.css',
    ]) {
      expect(classifyUrl(url).kind, url).toBe('in-app');
    }
  });

  it('is not fooled by look-alike hosts', () => {
    for (const url of [
      'https://evilreddit.com/',
      'https://reddit.com.evil.test/',
      'https://notredd.it.example/',
      'https://redd.it.evil.test/',
      'https://myreddit.com/',
    ]) {
      expect(classifyUrl(url).kind, url).toBe('external');
    }
  });

  it('sends unrelated links to the default browser', () => {
    for (const url of [
      'https://github.com/electron/electron',
      'https://www.youtube.com/watch?v=abc',
      'https://news.ycombinator.com/',
      'https://redditinc.com/policies',
      'https://www.reddithelp.com/',
    ]) {
      expect(classifyUrl(url).kind, url).toBe('external');
    }
  });

  it('allows identity providers so social sign-in can complete', () => {
    const decision = classifyUrl('https://accounts.google.com/signin/v2/identifier');
    expect(decision.kind).toBe('in-app');
    expect(decision.kind === 'in-app' && decision.isAuthFlow).toBe(true);
    expect(classifyUrl('https://appleid.apple.com/auth/authorize').kind).toBe('in-app');
  });

  it('never hands local or dangerous schemes to the app', () => {
    for (const url of [
      'http://localhost:5173/',
      'http://127.0.0.1:8080/admin',
      'file:///C:/Windows/System32/cmd.exe',
      'javascript:alert(1)',
      'data:text/html,<h1>hi</h1>',
      'blob:https://www.reddit.com/1234',
      'app://bundle/index.html',
      'chrome://settings',
    ]) {
      expect(classifyUrl(url).kind, url).toBe('blocked');
    }
  });

  it('hands mailto and tel to the operating system', () => {
    expect(classifyUrl('mailto:someone@example.com').kind).toBe('external');
    expect(classifyUrl('tel:+15550100').kind).toBe('external');
  });

  it('treats relative and malformed input safely', () => {
    expect(classifyUrl('/r/aww/').kind).toBe('in-app');
    expect(classifyUrl('//www.reddit.com/r/pics').kind).toBe('in-app');
    expect(classifyUrl('').kind).toBe('blocked');
    expect(classifyUrl('   ').kind).toBe('blocked');
    expect(classifyUrl('https://').kind).toBe('blocked');
    expect(classifyUrl(undefined as unknown as string).kind).toBe('blocked');
  });

  it('is case insensitive about hosts and schemes', () => {
    expect(classifyUrl('HTTPS://WWW.REDDIT.COM/r/pics/').kind).toBe('in-app');
    expect(classifyUrl('https://WWW.Reddit.com/login').kind).toBe('in-app');
  });
});

describe('isInAppUrl', () => {
  it('mirrors the decision kind', () => {
    expect(isInAppUrl('https://www.reddit.com/')).toBe(true);
    expect(isInAppUrl('https://example.com/')).toBe(false);
  });
});

describe('describeUrl', () => {
  it('produces a short human label', () => {
    expect(describeUrl('https://www.reddit.com/r/pics/')).toBe('reddit.com/r/pics');
    expect(describeUrl('https://www.reddit.com/')).toBe('reddit.com');
    expect(describeUrl('https://github.com/a/b')).toBe('github.com/a/b');
  });

  it('returns an empty label for blocked input', () => {
    expect(describeUrl('javascript:alert(1)')).toBe('');
  });
});
