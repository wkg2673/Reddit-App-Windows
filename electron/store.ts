import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Minimal, dependency-free JSON store.
 *
 * Writes are atomic (temp file + rename) and debounced so that dragging a
 * window does not hammer the disk.
 */
export class JsonStore<T extends object> {
  private readonly filePath: string;

  private cache: T | null = null;

  private pending: T | null = null;

  private timer: NodeJS.Timeout | null = null;

  constructor(fileName: string, baseDir: string) {
    this.filePath = join(baseDir, fileName);
  }

  get path(): string {
    return this.filePath;
  }

  read(): T | null {
    if (this.cache) return this.cache;
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return null;
      this.cache = parsed as T;
      return this.cache;
    } catch {
      return null;
    }
  }

  /** Applies a patch and schedules a debounced flush. */
  patch(partial: Partial<T>): void {
    const current = this.read() ?? ({} as T);
    const next = { ...current, ...partial } as T;
    this.cache = next;
    this.pending = next;
    this.schedule();
  }

  flush(): void {
    if (!this.pending) return;
    const data = this.pending;
    this.pending = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.tmp`;
      writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
      renameSync(temp, this.filePath);
    } catch (error) {
      console.error('[store] failed to persist state:', error);
    }
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 400);
    this.timer.unref?.();
  }
}
