/**
 * The uninstall handler writes a sync_status the database will accept.
 *
 * It used to write 'disabled', which is not in the table's check constraint, so
 * every uninstall failed the update and left the shop marked active with a
 * revoked token. Nothing caught it because the error was logged and swallowed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..', '..');

function allowedSyncStatuses(): string[] {
  const schema = readFileSync(resolve(root, 'supabase/schema.sql'), 'utf8');
  const match = schema.match(/check \(sync_status in \(([^)]*)\)\)/);
  if (!match) throw new Error('sync_status check constraint not found in schema.sql');
  return match[1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
}

describe('uninstall leaves the shop in a state the schema allows', () => {
  it('writes a sync_status the check constraint accepts', () => {
    const source = readFileSync(resolve(root, 'backend/src/services/shopifyWebhooks.ts'), 'utf8');
    const written = [...source.matchAll(/sync_status:\s*'([^']+)'/g)].map((m) => m[1]);

    expect(written.length).toBeGreaterThan(0);
    for (const status of written) {
      expect(allowedSyncStatuses(), `sync_status '${status}'`).toContain(status);
    }
  });

  it('the catalogue never lists a shop it has marked disconnected', () => {
    const source = readFileSync(resolve(root, 'backend/src/services/catalog/catalogContext.ts'), 'utf8');
    const filter = source.match(/sync_status\.in\.\(([^)]*)\)/);
    expect(filter, 'listActiveShops must filter by sync_status').not.toBeNull();
    expect(filter![1].split(',').map((v) => v.trim())).not.toContain('disconnected');
  });
});
