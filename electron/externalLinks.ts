import { classifyUrl } from '../shared/navigation';

/** Dispatched by the owner (the main process) to open a URL externally. */
export type OpenExternal = (url: string) => Promise<unknown> | unknown;

/**
 * Hands links to the operating system so they open in the user's default
 * browser, exactly once per URL.
 *
 * Several hooks observe the same navigation (`will-navigate`, the window open
 * handler and the request filter), so duplicates are suppressed here.
 */
export class ExternalLinkOpener {
  private readonly recentlyOpened = new Map<string, number>();

  constructor(
    private readonly open: OpenExternal,
    private readonly ttlMs = 1_500,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Returns true when the URL was actually dispatched. */
  async openUrl(rawUrl: string): Promise<boolean> {
    const decision = classifyUrl(rawUrl);
    if (decision.kind !== 'external') return false;

    const key = decision.url;
    const timestamp = this.now();
    const previous = this.recentlyOpened.get(key);
    if (previous !== undefined && timestamp - previous < this.ttlMs) return false;

    for (const [url, time] of this.recentlyOpened) {
      if (timestamp - time >= this.ttlMs) this.recentlyOpened.delete(url);
    }
    this.recentlyOpened.set(key, timestamp);

    try {
      await this.open(key);
      return true;
    } catch (error) {
      console.error('[external] failed to open in default browser:', key, error);
      return false;
    }
  }
}
