/**
 * The database has to accept everything the product offers.
 *
 * Growth advertises six treatments. Three of them could not be saved at all:
 * the check constraint on `style` still listed the three that shipped first,
 * so choosing Vintage in the admin produced a 500 and the radio snapped back.
 * Nothing in the code was wrong — the code and the column had simply drifted
 * apart, and no test was looking at both.
 *
 * This reads the migrations as text rather than talking to a database, which
 * is enough to catch the drift: a value the product can produce has to appear
 * in the constraint that governs its column.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GALLERY_EVENT_TYPES } from '../services/events/eventTypes.js';
import {
  GALLERY_FRAMES,
  GALLERY_LAYOUTS,
  GALLERY_STATUSES,
  GALLERY_STYLES,
} from '../services/gallery/galleryTypes.js';

const MIGRATIONS = join(process.cwd(), '..', 'supabase', 'migrations');

/**
 * The last definition wins, as it does in the database.
 *
 * A constraint is either named (`add constraint <name> check (...)`) or written
 * inline on the column when the table was created. Both are read, so a column
 * whose rule has never been altered is still covered.
 */
function latestConstraint(table: string, name: string, column: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let found = '';
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');

    // An inline check only counts when it is inside this table's definition:
    // other tables have columns of the same name and different rules.
    const created = new RegExp(`create table[^;]*?\\b${table}\\s*\\(([\\s\\S]*?);`, 'i').exec(sql);
    const inline = created && new RegExp(`check \\(${column} in \\([^)]*\\)\\)`, 'i').exec(created[1]);
    if (inline) found = inline[0];

    const altered = sql.match(new RegExp(`add constraint ${name}\\b[\\s\\S]*?;`, 'gi'));
    if (altered) found = altered[altered.length - 1];
  }
  return found;
}

describe('the columns accept every value the product can produce', () => {
  const cases: [string, string, string, readonly string[]][] = [
    ['gallery_configs', 'gallery_configs_style_check', 'style', GALLERY_STYLES],
    ['gallery_configs', 'gallery_configs_layout_check', 'layout', GALLERY_LAYOUTS],
    ['gallery_configs', 'gallery_configs_frame_check', 'frame', GALLERY_FRAMES],
    ['gallery_configs', 'gallery_configs_status_check', 'status', GALLERY_STATUSES],
    // The one that bit hardest: six of these were refused on insert, so the
    // features they measure reported zero while working perfectly.
    ['gallery_events', 'gallery_events_event_type_check', 'event_type', GALLERY_EVENT_TYPES],
  ];

  for (const [table, constraint, column, values] of cases) {
    it(`${constraint} allows all of: ${values.join(', ')}`, () => {
      const sql = latestConstraint(table, constraint, column);
      // A constraint with no migration of its own predates this repository's
      // migrations and cannot be checked here; that is worth knowing too.
      expect(sql, `no migration defines ${constraint}`).not.toBe('');
      for (const value of values) {
        expect(sql, `${constraint} rejects '${value}'`).toContain(`'${value}'`);
      }
    });
  }
});
