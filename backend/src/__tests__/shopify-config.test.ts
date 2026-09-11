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
  it('is linked to a client id different from the public listing', () => {
    expect(clientIdOf(development)).not.toBe('');
    expect(clientIdOf(production)).not.toBe('');
    expect(clientIdOf(development)).not.toBe(clientIdOf(production));
    expect(development).toContain('name = "Sillages (development)"');
  });

  it('requests only what this launch uses', () => {
    expect(scopesOf(development).sort()).toEqual(['read_inventory', 'read_products']);
  });

  it('stays inside what the public app has already been granted', () => {
    // The gallery ships over the existing public app. Requesting anything
    // outside its grant would re-prompt every installed merchant.
    for (const scope of scopesOf(development)) {
      expect(scopesOf(production), scope).toContain(scope);
    }
  });

  it('does not request write_pixels, because checkout measurement is not in this launch', () => {
    // The public app has read_pixels and never had write_pixels, so creating a
    // Web Pixel would need a new permission from every merchant for something
    // this release does not use.
    expect(scopesOf(development)).not.toContain('write_pixels');
    expect(scopesOf(development)).not.toContain('read_customer_events');
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

  it('keeps the public application on its own URLs', () => {
    // The pivot narrows the public app's scopes, and nothing else about it. Its
    // URLs in particular must never pick up a development tunnel.
    expect(production).toContain('sillages-production.up.railway.app');
    expect(production).not.toContain('trycloudflare.com');
    expect(development).not.toContain('sillages-production.up.railway.app');
  });

  it('asks merchants for the same two scopes in production as in development', () => {
    // One product, one permission story. A difference here would mean staging
    // proved something production does not do.
    expect(scopesOf(production).sort()).toEqual(scopesOf(development).sort());
    expect(scopesOf(production).sort()).toEqual(['read_inventory', 'read_products']);
  });

  it('drops the legacy permissions from the public app as well', () => {
    for (const scope of ['read_all_orders', 'read_customers', 'write_customers',
      'write_products', 'read_analytics', 'read_reports', 'read_pixels',
      'write_discounts', 'read_checkouts', 'write_marketing_events']) {
      expect(scopesOf(production), scope).not.toContain(scope);
    }
  });
});
