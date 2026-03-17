<script lang="ts">
	import { api } from '$lib/api';
	import { toastSuccess, toastError } from '$lib/stores/toast.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	let { open = $bindable(false), onCreated = () => {} }: { open?: boolean; onCreated?: () => void } = $props();

	let email = $state('');
	let password = $state('');
	let displayName = $state('');
	let role = $state('user');
	let saving = $state(false);
	let error = $state('');

	const roleOptions = [
		{ value: 'user', label: 'User' },
		{ value: 'admin', label: 'Admin' },
	];

	function reset() {
		email = '';
		password = '';
		displayName = '';
		role = 'user';
		error = '';
	}

	async function handleCreate() {
		error = '';
		if (!email.trim()) { error = 'Email is required.'; return; }
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = 'Invalid email format.'; return; }
		if (!password) { error = 'Password is required.'; return; }
		if (password.length < 8) { error = 'Password must be at least 8 characters.'; return; }

		saving = true;
		try {
			await api.fetch('data/users', {
				method: 'POST',
				body: {
					email: email.trim(),
					password,
					displayName: displayName.trim() || undefined,
					role,
				},
			});
			toastSuccess('User created successfully');
			open = false;
			reset();
			onCreated();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create user';
			toastError(error);
		} finally {
			saving = false;
		}
	}
</script>

<Modal bind:open title="Create User" onclose={reset}>
	<form class="form" onsubmit={(e) => { e.preventDefault(); handleCreate(); }}>
		<Input label="Email" type="email" bind:value={email} placeholder="user@example.com" required />
		<Input label="Password" type="password" bind:value={password} placeholder="Minimum 8 characters" required />
		<Input label="Display Name" bind:value={displayName} placeholder="(optional)" />
		<Select label="Role" options={roleOptions} bind:value={role} />

		{#if error}
			<p class="form__error">{error}</p>
		{/if}

		<button class="form__submit" type="submit" aria-hidden="true" tabindex="-1">Create User</button>
	</form>

	{#snippet footer()}
		<Button variant="secondary" onclick={() => { open = false; reset(); }}>Cancel</Button>
		<Button variant="primary" onclick={handleCreate} loading={saving}>
			Create User
		</Button>
	{/snippet}
</Modal>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.form__error {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}

	.form__submit {
		display: none;
	}
</style>
