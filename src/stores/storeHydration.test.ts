import { afterEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: loggerMocks }));

type StoreStorage = {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function installStorage(storage: StoreStorage) {
  vi.stubGlobal('window', { localStorage: storage });
}

async function importStores() {
  const [{ useSettingsStore }, { usePromptTemplateStore }] = await Promise.all([
    import('./settingsStore'),
    import('./promptTemplateStore'),
  ]);
  return { useSettingsStore, usePromptTemplateStore };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flushHydrationPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  loggerMocks.error.mockReset();
});

describe('persisted store hydration', () => {
  it('marks both stores hydrated immediately with synchronous storage, with or without saved data', async () => {
    for (const hasSavedData of [false, true]) {
      vi.resetModules();
      const storage = {
        getItem: (key: string) => {
          if (!hasSavedData) return null;
          const version = key === 'settings-storage' ? 32 : 1;
          return JSON.stringify({ state: {}, version });
        },
        setItem: vi.fn(),
        removeItem: vi.fn(),
      };
      installStorage(storage);

      const { useSettingsStore, usePromptTemplateStore } = await importStores();
      expect(useSettingsStore.getState().isHydrated).toBe(true);
      expect(usePromptTemplateStore.getState().isHydrated).toBe(true);
    }

    expect(loggerMocks.error).not.toHaveBeenCalledWith(
      expect.stringContaining('failed to hydrate'),
      expect.anything(),
    );
  });

  it('keeps both stores unhydrated until asynchronous storage resolves', async () => {
    const storedValues = new Map<string, ReturnType<typeof deferred<string | null>>>();
    installStorage({
      getItem: (key) => {
        const value = deferred<string | null>();
        storedValues.set(key, value);
        return value.promise;
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    const { useSettingsStore, usePromptTemplateStore } = await importStores();
    expect(useSettingsStore.getState().isHydrated).toBe(false);
    expect(usePromptTemplateStore.getState().isHydrated).toBe(false);

    storedValues.get('settings-storage')!.resolve(null);
    storedValues.get('prompt-template-storage')!.resolve(null);
    await flushHydrationPromises();

    expect(useSettingsStore.getState().isHydrated).toBe(true);
    expect(usePromptTemplateStore.getState().isHydrated).toBe(true);
    expect(loggerMocks.error).not.toHaveBeenCalled();
  });

  it('marks both stores hydrated when synchronous storage throws', async () => {
    installStorage({
      getItem: () => { throw new Error('storage unavailable'); },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    const { useSettingsStore, usePromptTemplateStore } = await importStores();

    expect(useSettingsStore.getState().isHydrated).toBe(true);
    expect(usePromptTemplateStore.getState().isHydrated).toBe(true);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      'failed to hydrate settings storage',
      expect.any(Error),
    );
    expect(loggerMocks.error).toHaveBeenCalledWith(
      'failed to hydrate prompt template storage',
      expect.any(Error),
    );
  });

  it('marks both stores hydrated and logs when asynchronous storage fails', async () => {
    const storedValues = new Map<string, ReturnType<typeof deferred<string | null>>>();
    installStorage({
      getItem: (key) => {
        const value = deferred<string | null>();
        storedValues.set(key, value);
        return value.promise;
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    const { useSettingsStore, usePromptTemplateStore } = await importStores();
    storedValues.get('settings-storage')!.reject(new Error('settings storage unavailable'));
    storedValues.get('prompt-template-storage')!.reject(new Error('template storage unavailable'));
    await flushHydrationPromises();

    expect(useSettingsStore.getState().isHydrated).toBe(true);
    expect(usePromptTemplateStore.getState().isHydrated).toBe(true);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      'failed to hydrate settings storage',
      expect.any(Error),
    );
    expect(loggerMocks.error).toHaveBeenCalledWith(
      'failed to hydrate prompt template storage',
      expect.any(Error),
    );
  });
});
