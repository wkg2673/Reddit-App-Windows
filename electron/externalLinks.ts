import { classifyUrl } from '../shared/navigation';

export type OpenExternal = (url: string) => Promise<unknown> | unknown;

export class ExternalLinkOpener {
  private readonly recentlyOpened = new Map<string, number>();

  constructor(
    private readonly open: OpenExternal,
    private readonly ttlMs = 1_500,
    private readonly now: () => number = () => Date.now(),
  ) {}

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
