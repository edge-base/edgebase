import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/svelte';
import { afterEach, beforeAll, vi } from 'vitest';

function createMemoryStorage(): Storage {
    const store = new Map<string, string>();

    return {
        get length() {
            return store.size;
        },
        clear() {
            store.clear();
        },
        getItem(key: string) {
            return store.get(key) ?? null;
        },
        key(index: number) {
            return Array.from(store.keys())[index] ?? null;
        },
        removeItem(key: string) {
            store.delete(key);
        },
        setItem(key: string, value: string) {
            store.set(key, String(value));
        },
    };
}

function ensureStorage(name: 'localStorage' | 'sessionStorage') {
    const existing = window[name];
    if (existing && typeof existing.getItem === 'function' && typeof existing.clear === 'function') {
        Object.defineProperty(globalThis, name, {
            configurable: true,
            value: existing,
        });
        return;
    }

    const storage = createMemoryStorage();
    Object.defineProperty(window, name, {
        configurable: true,
        value: storage,
    });
    Object.defineProperty(globalThis, name, {
        configurable: true,
        value: storage,
    });
}

beforeAll(() => {
    if (!window.requestAnimationFrame) {
        window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
            window.setTimeout(() => cb(performance.now()), 0)) as typeof window.requestAnimationFrame;
    }

    if (!window.cancelAnimationFrame) {
        window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as typeof window.cancelAnimationFrame;
    }

    ensureStorage('localStorage');
    ensureStorage('sessionStorage');

    if (!globalThis.ResizeObserver) {
        class ResizeObserverMock implements ResizeObserver {
            constructor(private readonly callback: ResizeObserverCallback) {}

            observe(target: Element): void {
                this.callback(
                    [
                        {
                            target,
                            contentRect: {
                                width: 640,
                                height: 320,
                                x: 0,
                                y: 0,
                                top: 0,
                                left: 0,
                                right: 640,
                                bottom: 320,
                                toJSON: () => ({}),
                            } as DOMRectReadOnly,
                            borderBoxSize: [] as unknown as ReadonlyArray<ResizeObserverSize>,
                            contentBoxSize: [] as unknown as ReadonlyArray<ResizeObserverSize>,
                            devicePixelContentBoxSize: [] as unknown as ReadonlyArray<ResizeObserverSize>,
                        },
                    ],
                    this,
                );
            }

            unobserve(): void {}
            disconnect(): void {}
        }

        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            value: ResizeObserverMock,
        });
    }

    if (!URL.createObjectURL) {
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            value: vi.fn(() => 'blob:mock'),
        });
    }

    if (!URL.revokeObjectURL) {
        Object.defineProperty(URL, 'revokeObjectURL', {
            configurable: true,
            value: vi.fn(),
        });
    }
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    vi.useRealTimers();
    vi.clearAllMocks();
});
