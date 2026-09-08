/**
 * The development Shopify app must stay separate from the public one.
 *
 * These are cheap assertions over two TOML files, and they exist because the
 * failure they prevent is expensive: deploying the development configuration
 * over the public listing, or quietly widening the scopes a live app requests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');
const production = readFileSync(resolve(root, 'shopify.app.toml'), 'utf8');
const development = readFileSync(resolve(root, 'shopify.app.dev.toml'), 'utf8');

function scopesOf(toml: string): string[] {
  const match = /^scopes\s*=\s*"([^"]*)"/m.exec(toml);
  return match ? match[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function clientIdOf(toml: string): string {
  const match = /^client_id\s*=\s*"([^"]*)"/m.exec(toml);
  return match ? match[1] : '';
}

describe('the development app is a separate app', () => {
  it('carries no client id, so it cannot be linked to the public listing by accident', () => {
    expect(clientIdOf(development)).toBe('');
    expect(clientIdOf(production)).not.toBe('');
  });

  it('requests only what the social-gallery product uses', () => {
    expect(scopesOf(development).sort()).toEqual(['read_customer_events', 'read_inventory', 'read_products', 'write_pixels']);
  });

  it('requests write_pixels, without which the Web Pixel can never be activated', () => {
    expect(scopesOf(development)).toContain('write_pixels');
    expect(scopesOf(development)).toContain('read_customer_events');
  });

  it('drops every scope the new product does not read', () => {
    const dropped = [
      'read_all_orders', 'read_customers', 'write_customers', 'read_analytics',
      'read_reports', 'write_products', 'write_discounts', 'read_checkouts',
      'write_marketing_events',
    ];
    for (const scope of dropped) {
      expect(scopesOf(development), scope).not.toContain(scope);
    }
  });

  it('still declares the mandatory privacy webhooks', () => {
    for (const topic of ['customers/data_request', 'customers/redact', 'shop/redact']) {
      expect(development, topic).toContain(topic);
    }
  });

  it('leaves the public application untouched', () => {
    // The production app is not ours to change in this branch: its scopes and
    // its URLs must stay exactly as they were.
    expect(production).toContain('sillages-production.up.railway.app');
    expect(scopesOf(production)).toContain('read_all_orders');
    expect(development).not.toContain('sillages-production.up.railway.app');
  });
});
