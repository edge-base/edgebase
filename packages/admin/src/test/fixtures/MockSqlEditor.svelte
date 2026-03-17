<script lang="ts">
	interface Props {
		value?: string;
		onchange?: (value: string) => void;
		onExecute?: () => void;
		placeholder?: string;
	}

	let { value = '', onchange, onExecute, placeholder = '' }: Props = $props();
</script>

<div data-testid="mock-sql-editor">
	<label for="mock-sql-editor-input">SQL Editor</label>
	<textarea
		id="mock-sql-editor-input"
		bind:value
		placeholder={placeholder}
		oninput={(e) => onchange?.((e.currentTarget as HTMLTextAreaElement).value)}
	></textarea>
	<button type="button" onclick={onExecute}>Editor Execute</button>
</div>
