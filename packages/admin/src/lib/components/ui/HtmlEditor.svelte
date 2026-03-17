<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { EditorView, keymap, placeholder as phPlugin } from '@codemirror/view';
	import { EditorState } from '@codemirror/state';
	import { html } from '@codemirror/lang-html';
	import { autocompletion } from '@codemirror/autocomplete';
	import { defaultKeymap, indentWithTab } from '@codemirror/commands';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';

	interface Props {
		value: string;
		onchange: (value: string) => void;
		placeholder?: string;
		readonly?: boolean;
	}

	let { value, onchange, placeholder = '', readonly = false }: Props = $props();

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
			html(),
			autocompletion(),
			keymap.of([
				...defaultKeymap,
				indentWithTab,
			]),
			EditorView.updateListener.of((update) => {
				if (update.docChanged) {
					const newVal = update.state.doc.toString();
					onchange(newVal);
				}
			}),
			EditorView.theme({
				'&': { fontSize: '13px', maxHeight: '400px' },
				'.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)' },
				'.cm-content': { minHeight: '200px', padding: '8px 0' },
				'&.cm-focused': { outline: 'none' },
			}),
		];

		if (placeholder) {
			extensions.push(phPlugin(placeholder));
		}

		if (readonly) {
			extensions.push(EditorState.readOnly.of(true));
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

<div class="html-editor-wrap" bind:this={container}></div>

<style>
	.html-editor-wrap {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.html-editor-wrap :global(.cm-editor) {
		min-height: 200px;
	}

	.html-editor-wrap :global(.cm-editor.cm-focused) {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
	}
</style>
