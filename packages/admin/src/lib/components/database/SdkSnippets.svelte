<script lang="ts">
	import { toastSuccess } from '$lib/stores/toast.svelte';
	import { schemaStore } from '$lib/stores/schema';
	import type { SchemaField } from '$lib/constants';

	let { tableName }: { tableName: string } = $props();

	let activeLang = $state<'javascript' | 'python' | 'dart' | 'swift' | 'kotlin'>('javascript');
	let activeOp = $state<'query' | 'insert' | 'update' | 'delete' | 'subscribe'>('query');

	const LANGS = [
		{ id: 'javascript' as const, label: 'JavaScript' },
		{ id: 'python' as const, label: 'Python' },
		{ id: 'dart' as const, label: 'Dart' },
		{ id: 'swift' as const, label: 'Swift' },
		{ id: 'kotlin' as const, label: 'Kotlin' },
	];

	const OPS = [
		{ id: 'query' as const, label: 'Query' },
		{ id: 'insert' as const, label: 'Insert' },
		{ id: 'update' as const, label: 'Update' },
		{ id: 'delete' as const, label: 'Delete' },
		{ id: 'subscribe' as const, label: 'Subscribe' },
	];

	let fields = $derived((() => {
		const table = $schemaStore.schema[tableName];
		return (table?.fields ?? {}) as Record<string, SchemaField>;
	})());

	let editableFieldNames = $derived(
		Object.keys(fields).filter(n => n !== 'id' && n !== 'createdAt' && n !== 'updatedAt')
	);

	function sampleValue(name: string, field: SchemaField): string {
		if (field.type === 'number' || field.type === 'integer' || field.type === 'float') return '42';
		if (field.type === 'boolean') return 'true';
		if (field.type === 'json') return '{"key": "value"}';
		if (field.type === 'datetime' || field.type === 'date') return '"2024-01-01T00:00:00Z"';
		if (field.enum && field.enum.length > 0) return `"${field.enum[0]}"`;
		return `"sample ${name}"`;
	}

	function insertFields(lang: string): string {
		const entries = editableFieldNames.slice(0, 4).map(name => {
			const field = fields[name];
			const val = sampleValue(name, field);
			if (lang === 'python') return `    "${name}": ${val}`;
			if (lang === 'dart') return `    "${name}": ${val}`;
			if (lang === 'swift') return `    "${name}": ${val}`;
			if (lang === 'kotlin') return `    "${name}" to ${val}`;
			return `  ${name}: ${val}`;
		});
		if (lang === 'kotlin') return entries.join(',\n');
		if (lang === 'python') return entries.join(',\n');
		return entries.join(',\n');
	}

	let snippet = $derived((() => {
		const t = tableName;
		const data = insertFields(activeLang);

		const snippets: Record<string, Record<string, string>> = {
			javascript: {
				query: `import { createClient } from '@edgebase/web';

const client = createClient('YOUR_URL');

const result = await client
  .db('shared').table('${t}')
  .limit(20)
  .getList();

console.log(result.items);`,
				insert: `const record = await client
  .db('shared').table('${t}')
  .insert({
${data}
  });`,
				update: `const updated = await client
  .db('shared').table('${t}')
  .update('RECORD_ID', {
${data}
  });`,
				delete: `await client
  .db('shared').table('${t}')
  .delete('RECORD_ID');`,
				subscribe: `const unsubscribe = client
  .db('shared').table('${t}')
  .onSnapshot((snapshot) => {
    console.log(snapshot.items);
    console.log(snapshot.changes);
  });

// Later: unsubscribe();`,
			},
			python: {
				query: `from edgebase import EdgeBase

client = EdgeBase("YOUR_URL")

result = client.db("shared").table("${t}").limit(20).get_list()
print(result.items)`,
				insert: `record = client.db("shared").table("${t}").insert({
${data}
})`,
				update: `updated = client.db("shared").table("${t}").doc("RECORD_ID").update({
${data}
})`,
				delete: `client.db("shared").table("${t}").doc("RECORD_ID").delete()`,
				subscribe: `def on_change(change):
    print(change)

unsub = client.db("shared").table("${t}").doc("RECORD_ID").on_snapshot(on_change)

# Later: unsub()`,
			},
			dart: {
				query: `import 'package:edgebase/edgebase.dart';

final client = EdgeBase.client('YOUR_URL');

final result = await client
  .db('shared').table('${t}')
  .limit(20)
  .getList();

print(result.items);`,
				insert: `final record = await client
  .db('shared').table('${t}')
  .insert({
${data}
  });`,
				update: `final updated = await client
  .db('shared').table('${t}')
  .doc('RECORD_ID')
  .update({
${data}
  });`,
				delete: `await client
  .db('shared').table('${t}')
  .doc('RECORD_ID')
  .delete();`,
				subscribe: `final stream = client
  .db('shared').table('${t}')
  .onSnapshot();

stream.listen((change) {
  print('\${change.event}: \${change.record}');
});`,
			},
			swift: {
				query: `import EdgeBase

let client = EdgeBaseClient("YOUR_URL")

let result = try await client
  .db("shared").table("${t}")
  .limit(20)
  .getList()

print(result.items)`,
				insert: `let record = try await client
  .db("shared").table("${t}")
  .insert([
${data}
  ])`,
				update: `let updated = try await client
  .db("shared").table("${t}")
  .doc("RECORD_ID")
  .update([
${data}
  ])`,
				delete: `try await client
  .db("shared").table("${t}")
  .doc("RECORD_ID")
  .delete()`,
				subscribe: `let stream = client
  .db("shared").table("${t}")
  .onSnapshot()

for await change in stream {
  print("\\(change.event): \\(change.record)")
}`,
			},
			kotlin: {
				query: `import dev.edgebase.sdk.client.ClientEdgeBase

val client = ClientEdgeBase("YOUR_URL")

val result = client
  .db("shared").table("${t}")
  .limit(20)
  .getList()

println(result.items)`,
				insert: `val record = client
  .db("shared").table("${t}")
  .insert(mapOf(
${data}
  ))`,
				update: `val updated = client
  .db("shared").table("${t}")
  .update("RECORD_ID", mapOf(
${data}
  ))`,
				delete: `client
  .db("shared").table("${t}")
  .delete("RECORD_ID")`,
				subscribe: `val flow = client
  .db("shared").table("${t}")
  .onSnapshot()

flow.collect { change ->
  println("\${change.event}: \${change.record}")
}`,
			},
		};

		return snippets[activeLang]?.[activeOp] ?? '';
	})());

	async function copySnippet() {
		try {
			await navigator.clipboard.writeText(snippet);
			toastSuccess('Copied to clipboard');
		} catch { /* ignore */ }
	}
</script>

<div class="sdk-snippets">
	<!-- Language tabs -->
	<div class="lang-tabs">
		{#each LANGS as lang}
			<button
				class="lang-tab"
				class:lang-tab--active={activeLang === lang.id}
				onclick={() => activeLang = lang.id}
			>
				{lang.label}
			</button>
		{/each}
	</div>

	<!-- Operation tabs -->
	<div class="op-tabs">
		{#each OPS as op}
			<button
				class="op-tab"
				class:op-tab--active={activeOp === op.id}
				onclick={() => activeOp = op.id}
			>
				{op.label}
			</button>
		{/each}
	</div>

	<!-- Code block -->
	<div class="code-block">
		<button class="copy-btn" onclick={copySnippet} title="Copy to clipboard">
			<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M11 5V3C11 2.448 10.552 2 10 2H3C2.448 2 2 2.448 2 3V10C2 10.552 2.448 11 3 11H5" stroke="currentColor" stroke-width="1.5"/></svg>
			Copy
		</button>
		<pre class="code-pre"><code>{snippet}</code></pre>
	</div>
</div>

<style>
	.sdk-snippets {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.lang-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
		border-bottom: 1px solid var(--color-border);
	}

	.lang-tab {
		padding: var(--space-2) var(--space-4);
		font-size: 13px;
		font-weight: 500;
		color: var(--color-text-secondary);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		margin-bottom: -1px;
	}

	.lang-tab:hover { color: var(--color-text); }
	.lang-tab--active {
		color: var(--color-primary);
		border-bottom-color: var(--color-primary);
	}

	.op-tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.op-tab {
		padding: var(--space-1) var(--space-3);
		font-size: 12px;
		font-weight: 500;
		color: var(--color-text-secondary);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 9999px;
		cursor: pointer;
	}

	.op-tab:hover { background: var(--color-bg-tertiary); }
	.op-tab--active {
		background: var(--color-primary);
		color: #fff;
		border-color: var(--color-primary);
	}

	.code-block {
		position: relative;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-bg-secondary);
		overflow: hidden;
	}

	.copy-btn {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: var(--space-1) var(--space-2);
		font-size: 11px;
		color: var(--color-text-secondary);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		z-index: 1;
	}

	.copy-btn:hover {
		background: var(--color-bg-tertiary);
		color: var(--color-text);
	}

	.code-pre {
		margin: 0;
		padding: var(--space-4);
		padding-right: 80px;
		font-family: var(--font-mono);
		font-size: 13px;
		line-height: 1.5;
		color: var(--color-text);
		overflow-x: auto;
		white-space: pre;
		tab-size: 2;
	}
</style>
