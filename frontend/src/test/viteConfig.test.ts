/**
 * The dev server has to be reachable through the Shopify CLI's tunnel.
 *
 * Vite rejects requests whose Host header it does not recognise. Because the
 * CLI serves the admin through an ephemeral `*.trycloudflare.com` name, every
 * request through the tunnel came back as 403 "This host is not allowed" — the
 * merchant saw that instead of the app, and nothing in the test suite noticed
 * because the failure only exists when a tunnel is in front.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const config = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8');

describe('the dev server accepts the Shopify CLI tunnel', () => {
  it('allows every tunnel host the CLI might hand us', () => {
    // Leading dots so a new tunnel name never needs a code change.
    for (const host of ['.trycloudflare.com', '.ngrok.io', '.shopifypreview.com']) {
      expect(config, host).toContain(`'${host}'`);
    }
  });

  it('still allows local development', () => {
    expect(config).toContain("'localhost'");
  });

  it('does not disable host checking altogether', () => {
    // `allowedHosts: true` would accept any Host header, which is the DNS
    // rebinding hole this setting exists to close.
    expect(config).not.toMatch(/allowedHosts:\s*true/);
  });

  it('proxies the API to the port the CLI assigned, not a hard-coded one', () => {
    // The CLI picks a random backend port and passes it as BACKEND_PORT.
    // Hard-coding 3001 meant every API call through the tunnel died.
    expect(config).toContain('process.env.BACKEND_PORT');
  });
});
