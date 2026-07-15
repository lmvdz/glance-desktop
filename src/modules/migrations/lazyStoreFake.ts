/**
 * Minimal in-memory stand-in for `@tauri-apps/plugin-store`'s `LazyStore`,
 * shared by the migration-safety regression tests for every module that
 * calls `migrateLazyStoreOnce` (sessions/agents/todos/snippets/spaces/
 * settings/customThemes — see each module's `*.test.ts`).
 *
 * Keyed by store path so the "new" store a module constructs at import
 * time and the "old" store `migrateLazyStoreOnce` constructs internally —
 * two separate `new LazyStore(...)` calls — share the same simulated
 * on-disk file, exactly like two real LazyStore handles pointed at the
 * same path would.
 *
 * Test-only: not imported by any production module.
 */
export class FakeLazyStoreRegistry {
  private files = new Map<string, Map<string, unknown>>();

  private fileFor(path: string): Map<string, unknown> {
    let file = this.files.get(path);
    if (!file) {
      file = new Map();
      this.files.set(path, file);
    }
    return file;
  }

  /** Seed a path with data, as if it already existed on disk before the
   *  module under test ever touched it. */
  seed(path: string, entries: Record<string, unknown>): void {
    const file = this.fileFor(path);
    for (const [key, value] of Object.entries(entries)) file.set(key, value);
  }

  snapshot(path: string): Record<string, unknown> {
    return Object.fromEntries(this.fileFor(path));
  }

  /** Clears every simulated file — call between tests for isolation. */
  reset(): void {
    this.files.clear();
  }

  /** A `LazyStore`-shaped constructor bound to this registry. Pass this as
   *  the `LazyStore` export when mocking `@tauri-apps/plugin-store`. */
  readonly LazyStoreCtor: new (
    path: string,
    options?: { defaults?: Record<string, unknown>; autoSave?: boolean | number },
  ) => {
    entries<T>(): Promise<Array<[string, T]>>;
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    has(key: string): Promise<boolean>;
    delete(key: string): Promise<boolean>;
    clear(): Promise<void>;
    reset(): Promise<void>;
    keys(): Promise<string[]>;
    values<T>(): Promise<T[]>;
    length(): Promise<number>;
    reload(): Promise<void>;
    save(): Promise<void>;
    onKeyChange(): Promise<() => void>;
    onChange(): Promise<() => void>;
    close(): Promise<void>;
  };

  constructor() {
    const registry = this;
    this.LazyStoreCtor = class {
      private readonly file: Map<string, unknown>;
      constructor(path: string) {
        this.file = registry.fileFor(path);
      }
      async entries<T>(): Promise<Array<[string, T]>> {
        return Array.from(this.file.entries()) as Array<[string, T]>;
      }
      async get<T>(key: string): Promise<T | undefined> {
        return this.file.get(key) as T | undefined;
      }
      async set(key: string, value: unknown): Promise<void> {
        this.file.set(key, value);
      }
      async has(key: string): Promise<boolean> {
        return this.file.has(key);
      }
      async delete(key: string): Promise<boolean> {
        return this.file.delete(key);
      }
      async clear(): Promise<void> {
        this.file.clear();
      }
      async reset(): Promise<void> {
        this.file.clear();
      }
      async keys(): Promise<string[]> {
        return Array.from(this.file.keys());
      }
      async values<T>(): Promise<T[]> {
        return Array.from(this.file.values()) as T[];
      }
      async length(): Promise<number> {
        return this.file.size;
      }
      async reload(): Promise<void> {}
      async save(): Promise<void> {}
      async onKeyChange(): Promise<() => void> {
        return () => {};
      }
      async onChange(): Promise<() => void> {
        return () => {};
      }
      async close(): Promise<void> {}
    };
  }
}
