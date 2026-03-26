<script lang="ts">
	import { base } from '$app/paths';
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { describeActionError } from '$lib/error-messages';
	import { toastError, addToast } from '$lib/stores/toast.svelte';
	import { devInfoStore } from '$lib/stores/devInfo';
	import PageShell from '$lib/components/layout/PageShell.svelte';
	import { emailDocs } from '$lib/docs-links';
	import Button from '$lib/components/ui/Button.svelte';
	import Tabs from '$lib/components/ui/Tabs.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import HtmlEditor from '$lib/components/ui/HtmlEditor.svelte';
	import {
		EMAIL_TYPES,
		SUPPORTED_LOCALES,
		DEFAULT_SUBJECTS,
		DEFAULT_TEMPLATES,
		VARIABLE_REFERENCE,
		renderPreview,
		getDefaultSubjectForLocale,
		getDefaultTemplateForLocale,
		resolveLocalizedValue,
		type EmailType,
		type LocalizedString,
	} from '$lib/email-defaults';

	interface EmailTemplateConfig {
		appName: string;
		configured: boolean;
		subjects: Record<string, LocalizedString | null>;
		templates: Record<string, LocalizedString | null>;
	}

	let loading = $state(true);
	let saving = $state(false);
	let config = $state<EmailTemplateConfig | null>(null);
	let loadError = $state('');

	// Language selector
	let selectedLocale = $state('en');

	// Per-tab, per-locale editing state
	// Key: `${type}:${locale}` → edited value
	let editSubjects = $state<Record<string, string>>({});
	let editTemplates = $state<Record<string, string>>({});

	let activeTab = $state('verification');
	let showPreview = $state(false);

	const tabs = EMAIL_TYPES.map((t) => ({ id: t.id, label: t.label }));

	/** Get the editing key for current type + locale */
	function editKey(type: EmailType, locale: string): string {
		return `${type}:${locale}`;
	}

	/** Get the default subject for a type + locale */
	function defaultSubject(type: EmailType, locale: string): string {
		return getDefaultSubjectForLocale(type, locale);
	}

	/** Get the default template for a type + locale */
	function defaultTemplate(type: EmailType, locale: string): string {
		return getDefaultTemplateForLocale(type, locale);
	}

	/** Resolve the effective subject from config for a given type + locale */
	function resolveConfigSubject(type: EmailType, locale: string): string | undefined {
		if (!config) return undefined;
		return resolveLocalizedValue(config.subjects[type], locale);
	}

	/** Resolve the effective template from config for a given type + locale */
	function resolveConfigTemplate(type: EmailType, locale: string): string | undefined {
		if (!config) return undefined;
		return resolveLocalizedValue(config.templates[type], locale);
	}

	/** Initialize editing state for a type + locale (loads from config or default) */
	function initEditState(type: EmailType, locale: string) {
		const key = editKey(type, locale);
		if (editSubjects[key] === undefined) {
			editSubjects[key] = resolveConfigSubject(type, locale) ?? defaultSubject(type, locale);
		}
		if (editTemplates[key] === undefined) {
			editTemplates[key] = resolveConfigTemplate(type, locale) ?? defaultTemplate(type, locale);
		}
	}

	onMount(async () => {
		try {
			config = await api.fetch<EmailTemplateConfig>('data/email/templates');
			// Initialize editing state for all types + English
			for (const type of EMAIL_TYPES) {
				initEditState(type.id, 'en');
			}
		} catch (err) {
			loadError = describeActionError(err, 'Failed to load email templates.');
			toastError(loadError);
		} finally {
			loading = false;
		}
	});

	// Ensure edit state is initialized when locale changes
	$effect(() => {
		if (config) {
			for (const type of EMAIL_TYPES) {
				initEditState(type.id, selectedLocale);
			}
		}
	});

	const currentType = $derived(activeTab as EmailType);
	const currentKey = $derived(editKey(currentType, selectedLocale));
	const currentSubject = $derived(editSubjects[currentKey] ?? defaultSubject(currentType, selectedLocale));
	const currentTemplate = $derived(editTemplates[currentKey] ?? defaultTemplate(currentType, selectedLocale));
	const previewHtml = $derived(renderPreview(currentTemplate, currentType));

	const currentDefaultSubject = $derived(defaultSubject(currentType, selectedLocale));
	const currentDefaultTemplate = $derived(defaultTemplate(currentType, selectedLocale));

	const isCustomSubject = $derived(currentSubject !== currentDefaultSubject);
	const isCustomTemplate = $derived(currentTemplate !== currentDefaultTemplate);

	const hasChanges = $derived(() => {
		if (!config) return false;
		const origSubject = resolveConfigSubject(currentType, selectedLocale) ?? currentDefaultSubject;
		const origTemplate = resolveConfigTemplate(currentType, selectedLocale) ?? currentDefaultTemplate;
		return currentSubject !== origSubject || currentTemplate !== origTemplate;
	});

	async function handleSave() {
		if (!$devInfoStore.devMode) return;
		saving = true;
		try {
			const body: Record<string, unknown> = { type: currentType, locale: selectedLocale };

			// Determine what to send for subject
			if (currentSubject === currentDefaultSubject) {
				// Reset to built-in default: send null to remove override
				const existingOverride = resolveConfigSubject(currentType, selectedLocale);
				if (existingOverride) {
					body.subject = null;
				}
			} else {
				body.subject = currentSubject;
			}

			// Determine what to send for template
			if (currentTemplate === currentDefaultTemplate) {
				// Reset to built-in default: send null to remove override
				const existingOverride = resolveConfigTemplate(currentType, selectedLocale);
				if (existingOverride) {
					body.template = null;
				}
			} else {
				body.template = currentTemplate;
			}

			await api.schemaMutation('email/templates', {
				method: 'PUT',
				body,
			});

			// Update local config state (approximate — full refresh on next load)
			if (config) {
				const updateLocalized = (
					existing: LocalizedString | null | undefined,
					locale: string,
					value: string | null,
				): LocalizedString | null => {
					if (locale === 'en' && (typeof existing === 'string' || !existing)) {
						// Simple string mode
						return value;
					}
					// Object mode
					const obj: Record<string, string> = typeof existing === 'object' && existing !== null ? { ...existing } : {};
					if (value === null) {
						delete obj[locale];
						// If only 'en' left and it exists, could simplify — but keep object for consistency
						return Object.keys(obj).length === 0 ? null : obj;
					}
					obj[locale] = value;
					return obj;
				};

				if (body.subject !== undefined) {
					config.subjects[currentType] = updateLocalized(
						config.subjects[currentType],
						selectedLocale,
						currentSubject === currentDefaultSubject ? null : currentSubject,
					);
				}
				if (body.template !== undefined) {
					config.templates[currentType] = updateLocalized(
						config.templates[currentType],
						selectedLocale,
						currentTemplate === currentDefaultTemplate ? null : currentTemplate,
					);
				}
			}

			const localeName = SUPPORTED_LOCALES.find((l) => l.code === selectedLocale)?.label ?? selectedLocale;
			addToast({
				type: 'success',
				message: `Email template for "${EMAIL_TYPES.find((t) => t.id === currentType)?.label}" (${localeName}) saved.`,
			});
		} catch (err) {
			toastError(describeActionError(err, 'Failed to save the email template.'));
		} finally {
			saving = false;
		}
	}

	function handleReset() {
		const key = currentKey;
		editSubjects[key] = currentDefaultSubject;
		editTemplates[key] = currentDefaultTemplate;
	}
</script>

<PageShell title="Email Templates" description="Customize authentication email templates and subjects" docsHref={emailDocs}>
	{#snippet actions()}
		<a href="{base}/auth/settings">
			<Button variant="ghost" size="sm">Auth Settings</Button>
		</a>
	{/snippet}

	{#if loading}
		<div class="loading-state">
			<span class="spinner"></span>
			Loading email templates...
		</div>
	{:else if !config}
		<div class="error-state">{loadError || 'Failed to load email template configuration. Check that the EdgeBase admin API is running and retry.'}</div>
	{:else}
		<!-- Language Selector -->
		<div class="locale-selector">
			<label class="locale-label" for="locale-select">Language</label>
			<select id="locale-select" class="locale-select" bind:value={selectedLocale}>
				{#each SUPPORTED_LOCALES as locale (locale.code)}
					<option value={locale.code}>{locale.label}</option>
				{/each}
			</select>
			{#if selectedLocale !== 'en'}
				<span class="locale-hint">
					Editing {SUPPORTED_LOCALES.find((l) => l.code === selectedLocale)?.label} template overrides. Built-in translations are used when no override is set.
				</span>
			{/if}
		</div>

		<Tabs {tabs} bind:activeTab>
			<div class="template-editor">
				<!-- Subject -->
				<div class="editor-section">
					<div class="section-header">
						<h3 class="section-title">Subject Line</h3>
						{#if isCustomSubject}
							<span class="custom-badge">Custom</span>
						{/if}
					</div>
					<Input
						label=""
						value={currentSubject}
						oninput={(e) => { editSubjects[currentKey] = e.currentTarget.value; }}
						placeholder={currentDefaultSubject}
						disabled={!$devInfoStore.devMode}
					/>
					<p class="hint">Use <code>{'{{appName}}'}</code> to insert the application name.</p>
				</div>

				<!-- HTML Template -->
				<div class="editor-section">
					<div class="section-header">
						<h3 class="section-title">HTML Template</h3>
						<div class="section-actions">
							{#if isCustomTemplate}
								<span class="custom-badge">Custom</span>
							{/if}
							<button
								class="preview-toggle"
								class:preview-toggle--active={showPreview}
								onclick={() => (showPreview = !showPreview)}
							>
								{showPreview ? 'Hide Preview' : 'Show Preview'}
							</button>
						</div>
					</div>
					{#if !$devInfoStore.devMode}
						<div class="readonly-editor">
							<HtmlEditor
								value={currentTemplate}
								onchange={() => {}}
								readonly={true}
							/>
						</div>
					{:else}
						<HtmlEditor
							value={currentTemplate}
							onchange={(v) => (editTemplates[currentKey] = v)}
						/>
					{/if}
				</div>

				<!-- Live Preview -->
				{#if showPreview}
					<div class="editor-section">
						<h3 class="section-title">Preview</h3>
						<div class="preview-frame">
							<iframe
								title="Email Preview"
								srcdoc={previewHtml}
								sandbox=""
								class="preview-iframe"
							></iframe>
						</div>
					</div>
				{/if}

				<!-- Variable Reference -->
				<div class="editor-section">
					<h3 class="section-title">Available Variables</h3>
					<div class="var-table">
						<div class="var-row var-row--header">
							<span class="var-name">Variable</span>
							<span class="var-desc">Description</span>
						</div>
						{#each VARIABLE_REFERENCE[currentType] as v (v.name)}
							<div class="var-row">
								<code class="var-name">{v.name}</code>
								<span class="var-desc">{v.description}</span>
							</div>
						{/each}
					</div>
				</div>

				<!-- Actions -->
				{#if $devInfoStore.devMode}
					<div class="editor-actions">
						<Button variant="primary" size="sm" onclick={handleSave} disabled={saving}>
							{saving ? 'Saving...' : 'Save Changes'}
						</Button>
						<Button variant="ghost" size="sm" onclick={handleReset}>
							Reset to Default
						</Button>
					</div>
				{/if}
			</div>
		</Tabs>

		{#if !$devInfoStore.devMode}
			<div class="readonly-notice">
				Email templates are configured in your <code>edgebase.config.ts</code>. Editing is only available in dev mode.
			</div>
		{:else}
			<div class="dev-notice">
				Changes are saved to <code>edgebase.config.ts</code>. The dev server will auto-restart to apply changes.
			</div>
		{/if}
	{/if}
</PageShell>

<style>
	.loading-state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-7);
		color: var(--color-text-secondary);
	}

	.spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.error-state {
		padding: var(--space-7);
		text-align: center;
		color: var(--color-danger);
	}

	/* ─── Language Selector ─── */

	.locale-selector {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
		padding: var(--space-3) var(--space-4);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.locale-label {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
	}

	.locale-select {
		font-family: inherit;
		font-size: 0.8125rem;
		padding: 4px 8px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-bg);
		color: var(--color-text);
		cursor: pointer;
	}

	.locale-select:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
	}

	.locale-hint {
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		margin-left: var(--space-2);
	}

	/* ─── Template Editor ─── */

	.template-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.editor-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.section-title {
		margin: 0;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.section-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-left: auto;
	}

	.custom-badge {
		display: inline-block;
		padding: 1px 6px;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 10%, transparent);
		border-radius: 9999px;
	}

	.preview-toggle {
		font-size: 0.75rem;
		font-family: inherit;
		font-weight: 500;
		color: var(--color-text-secondary);
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: 2px 8px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.preview-toggle:hover {
		color: var(--color-text);
		border-color: var(--color-text-secondary);
	}

	.preview-toggle--active {
		color: var(--color-primary);
		border-color: var(--color-primary);
	}

	.hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.hint code {
		font-size: 0.75rem;
		padding: 1px 4px;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
	}

	.preview-frame {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: #fff;
	}

	.preview-iframe {
		width: 100%;
		height: 500px;
		border: none;
	}

	.var-table {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.var-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		font-size: 0.8125rem;
		border-bottom: 1px solid var(--color-border);
	}

	.var-row:last-child {
		border-bottom: none;
	}

	.var-row--header {
		background: var(--color-bg-secondary);
		font-weight: 600;
		color: var(--color-text);
	}

	.var-name {
		min-width: 180px;
		font-family: var(--font-mono);
		font-size: 0.75rem;
		color: var(--color-primary);
	}

	.var-row--header .var-name {
		font-family: inherit;
		font-size: 0.8125rem;
		color: inherit;
	}

	.var-desc {
		color: var(--color-text-secondary);
	}

	.var-row--header .var-desc {
		color: inherit;
	}

	.editor-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding-top: var(--space-2);
	}

	.readonly-notice {
		margin-top: var(--space-5);
		padding: var(--space-3) var(--space-4);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.dev-notice {
		margin-top: var(--space-5);
		padding: var(--space-3) var(--space-4);
		background: color-mix(in srgb, var(--color-primary) 5%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-primary) 20%, transparent);
		border-radius: var(--radius-md);
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
	}

	.readonly-notice code,
	.dev-notice code {
		font-size: 0.8125rem;
		padding: 1px 4px;
		background: var(--color-bg-secondary);
		border-radius: var(--radius-sm);
	}

	.readonly-editor {
		opacity: 0.7;
		pointer-events: none;
	}
</style>
