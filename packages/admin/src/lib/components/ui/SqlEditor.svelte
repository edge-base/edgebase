<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { EditorView, keymap, placeholder as phPlugin } from '@codemirror/view';
	import { EditorState } from '@codemirror/state';
	import { sql, SQLite } from '@codemirror/lang-sql';
	import { autocompletion } from '@codemirror/autocomplete';
	import { defaultKeymap, indentWithTab } from '@codemirror/commands';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';

	interface Props {
		value: string;
		onchange: (value: string) => void;
		onExecute?: () => void;
		placeholder?: string;
		schema?: Record<string, string[]>;
	}

	let { value, onchange, onExecute, placeholder = '', schema = {} }: Props = $props();

	let container: HTMLDivElement;
	let view: EditorView | undefined;
	let isDark = $state(false);

	function detectDark(): boolean {
		return document.documentElement.dataset.theme === 'dark' ||
			(document.documentElement.dataset.theme !== 'light' &&
			window.matchMedia('(prefers-color-scheme: dark)').matches);
	}

	function buildExtensions() {
		const extensions = [
			sql({ dialect: SQLite, schema: schema }),
			autocompletion(),
			keymap.of([
				...defaultKeymap,
				indentWithTab,
				{
					key: 'Mod-Enter',
					run: () => { onExecute?.(); return true; },
				},
			]),
			EditorView.updateListener.of((update) => {
				if (update.docChanged) {
					const newVal = update.state.doc.toString();
					onchange(newVal);
				}
			}),
			EditorView.theme({
				'&': { fontSize: '13px', maxHeight: '300px' },
				'.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)' },
				'.cm-content': { minHeight: '100px', padding: '8px 0' },
				'&.cm-focused': { outline: 'none' },
			}),
		];

		if (placeholder) {
			extensions.push(phPlugin(placeholder));
		}

		if (isDark) {
			extensions.push(oneDark);
		} else {
			extensions.push(syntaxHighlighting(defaultHighlightStyle));
		}

		return extensions;
	}

	function createEditor() {
		if (view) view.destroy();

		view = new EditorView({
			state: EditorState.create({
				doc: value,
				extensions: buildExtensions(),
			}),
			parent: container,
		});
	}

	onMount(() => {
		isDark = detectDark();
		createEditor();

		// Watch for theme changes
		const observer = new MutationObserver(() => {
			const newDark = detectDark();
			if (newDark !== isDark) {
				isDark = newDark;
				const currentDoc = view?.state.doc.toString() ?? value;
				createEditor();
				if (currentDoc !== value) {
					view?.dispatch({
						changes: { from: 0, to: view.state.doc.length, insert: currentDoc },
					});
				}
			}
		});
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

		return () => {
			observer.disconnect();
			view?.destroy();
		};
	});

	onDestroy(() => {
		view?.destroy();
	});

	// Sync external value changes into the editor
	$effect(() => {
		if (view && value !== view.state.doc.toString()) {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: value },
			});
		}
	});
</script>

<div class="sql-editor-wrap" bind:this={container}></div>

<style>
	.sql-editor-wrap {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.sql-editor-wrap :global(.cm-editor) {
		min-height: 120px;
	}

	.sql-editor-wrap :global(.cm-editor.cm-focused) {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
	}
</style>
