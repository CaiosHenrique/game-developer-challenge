/** A minimal in-memory Storage. */
export function createMemoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, String(value));
    },
  };
}

function storageReadable(): boolean {
  try {
    window.localStorage.getItem('pirate-battle.probe');
    return true;
  } catch {
    return false;
  }
}

/**
 * MSW reads `localStorage` once, while its module is first evaluated (for its cookie store),
 * and fails to load when storage is blocked. While `load` runs, a blocked storage is replaced
 * by an in-memory one; the real property is restored right after, so the rest of the app
 * still sees storage as unavailable and never claims that data was saved.
 */
export async function withReadableStorage<T>(load: () => Promise<T>): Promise<T> {
  if (storageReadable()) return load();
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  if (!original?.configurable) return load();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    enumerable: original.enumerable ?? true,
    value: createMemoryStorage(),
  });
  try {
    return await load();
  } finally {
    Object.defineProperty(window, 'localStorage', original);
  }
}
