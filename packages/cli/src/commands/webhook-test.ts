import { Command } from 'commander';
import chalk from 'chalk';
import { raiseCliError } from '../lib/agent-contract.js';
import { isJson, isQuiet } from '../lib/cli-context.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';

/**
 * `npx edgebase webhook-test` — Send test webhook events to local dev server.
 * Useful for testing Stripe/payment plugin webhooks without Stripe CLI.
 */

interface WebhookEvent {
  name: string;
  type: string;
  data: Record<string, unknown>;
}

const STRIPE_EVENTS: WebhookEvent[] = [
  {
    name: 'Checkout completed',
    type: 'checkout.session.completed',
    data: {
      customer: 'cus_test_123',
      customer_email: 'test@example.com',
      payment_status: 'paid',
      metadata: { userId: 'test-user-001' },
    },
  },
  {
    name: 'Subscription created',
    type: 'customer.subscription.updated',
    data: {
      id: 'sub_test_123',
      status: 'active',
      current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
      items: { data: [{ price: { id: 'price_pro_monthly' } }] },
    },
  },
  {
    name: 'Subscription cancelled',
    type: 'customer.subscription.deleted',
    data: {
      id: 'sub_test_123',
      status: 'canceled',
      current_period_end: Math.floor(Date.now() / 1000),
      items: { data: [{ price: { id: 'price_pro_monthly' } }] },
    },
  },
  {
    name: 'Payment succeeded',
    type: 'invoice.payment_succeeded',
    data: {
      payment_intent: 'pi_test_123',
      amount_paid: 2900,
      currency: 'usd',
      metadata: { userId: 'test-user-001' },
    },
  },
];

export const webhookTestCommand = new Command('webhook-test')
  .description('Send test webhook events to local dev server')
  .argument('[provider]', 'Provider to simulate (stripe)', 'stripe')
  .option('-u, --url <url>', 'Webhook URL', 'http://localhost:8787/api/functions/plugin-stripe/webhook')
  .option('-e, --event <type>', 'Specific event type to send')
  .option('-a, --all', 'Send all test events')
  .action(async (provider: string, options: { url: string; event?: string; all?: boolean }) => {
    if (!isQuiet()) {
      console.log(chalk.blue('🔔'), `Webhook test — provider: ${chalk.cyan(provider)}`);
      console.log(chalk.dim(`   Target: ${options.url}`));
      console.log();
    }

    const events = provider === 'stripe' ? STRIPE_EVENTS : [];
    if (events.length === 0) {
      raiseCliError({
        code: 'webhook_provider_unknown',
        field: 'provider',
        message: `Unknown provider: ${provider}`,
      });
    }

    const toSend = options.event
      ? events.filter(e => e.type === options.event)
      : options.all
        ? events
        : [events[0]]; // Default: send first event only

    if (toSend.length === 0) {
      raiseCliError({
        code: 'webhook_event_not_found',
        field: 'event',
        message: `No test event matched '${options.event}'.`,
        hint: 'Use --all or choose one of the predefined Stripe test event types.',
      });
    }

    const results: Array<{ type: string; ok: boolean; status?: number; body?: string; error?: string }> = [];

    for (const evt of toSend) {
      const payload = {
        id: `evt_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: evt.type,
        data: { object: evt.data },
        created: Math.floor(Date.now() / 1000),
      };

      try {
        const res = await fetchWithTimeout(options.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.text();
        const status = res.ok ? chalk.green(`${res.status}`) : chalk.red(`${res.status}`);
        results.push({ type: evt.type, ok: res.ok, status: res.status, body });
        if (!isQuiet()) {
          console.log(`  ${status} ${chalk.cyan(evt.type)} (${evt.name}) → ${body}`);
        }
      } catch (err) {
        results.push({ type: evt.type, ok: false, error: (err as Error).message });
        if (!isQuiet()) {
          console.log(`  ${chalk.red('ERR')} ${chalk.cyan(evt.type)} → ${(err as Error).message}`);
        }
      }
    }

    const failures = results.filter((result) => !result.ok);
    if (failures.length > 0) {
      raiseCliError({
        code: 'webhook_test_failed',
        message: `${failures.length} test webhook event(s) failed.`,
        hint: 'Check the target URL and server logs, then retry.',
        details: {
          url: options.url,
          results,
        },
      });
    }

    if (isJson()) {
      console.log(JSON.stringify({
        status: 'success',
        provider,
        url: options.url,
        results,
      }));
      return;
    }

    console.log();
    console.log(chalk.green('✅'), 'Done! Check server logs for processing results.');
  });
