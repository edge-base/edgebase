import { get, writable } from 'svelte/store';

const STORAGE_KEY = 'edgebase_theme';

export type Theme = 'light' | 'dark';

let currentTheme: Theme = 'light';
export const themeStore = writable<Theme>(currentTheme);

export function getTheme(): Theme {
	return get(themeStore);
}

export function initTheme(): void {
	if (typeof window === 'undefined') return;

	const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
	if (stored === 'light' || stored === 'dark') {
		currentTheme = stored;
	} else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
		currentTheme = 'dark';
	}

	syncTheme(currentTheme);
}

export function toggleTheme(): Theme {
	currentTheme = currentTheme === 'light' ? 'dark' : 'light';
	localStorage.setItem(STORAGE_KEY, currentTheme);
	syncTheme(currentTheme);
	return currentTheme;
}

export function setTheme(theme: Theme): void {
	currentTheme = theme;
	localStorage.setItem(STORAGE_KEY, theme);
	syncTheme(theme);
}

function applyTheme(theme: Theme): void {
	document.documentElement.setAttribute('data-theme', theme);
}

function syncTheme(theme: Theme): void {
	currentTheme = theme;
	themeStore.set(theme);
	applyTheme(theme);
}
