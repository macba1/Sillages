/**
 * Content engine tests — image generation, caption parsing, DM draft limits,
 * 1-post/day idempotency, and Postiz config gating.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

// ── Mocks ────────────────────────────────────────────────────────────────────
const openaiCreate = vi.fn();
vi.mock('../lib/openai.js', () => ({
  openai: { chat: { completions: { create: (...a: any[]) => openaiCreate(...a) } } },
}));

// Table-aware supabase mock (awaitable builder; maybeSingle/single/insert/upsert).
interface TableFixture { list?: any; single?: any; insert?: any }
let fixtures: Record<string, TableFixture> = {};
const inserted: Record<string, any[]> = {};
function makeBuilder(table: string): any {
  const fx = fixtures[table] ?? {};
  const b: any = {
    select: () => b, eq: () => b, neq: () => b, gt: () => b, gte: () => b, order: () => b, limit: () => b,
    maybeSingle: () => Promise.resolve(fx.single ?? { data: null, error: null }),
    single: () => Promise.resolve(fx.single ?? { data: { id: 'row1' }, error: null }),
    insert: (row: any) => { (inserted[table] ??= []).push(row); return { select: () => ({ single: () => Promise.resolve(fx.insert ?? { data: { id: 'row1' }, error: null }) }) }; },
    upsert: (row: any) => { (inserted[table] ??= []).push(row); return Promise.resolve({ data: null, error: null }); },
    then: (resolve: any) => resolve(fx.list ?? { data: [], error: null }),
  };
  return b;
}
vi.mock('../lib/supabase.js', () => ({ supabase: { from: (t: string) => makeBuilder(t) } }));

vi.mock('../config/env.js', () => ({
  env: { OPENAI_API_KEY: 'x', POSTIZ_API_URL: undefined, POSTIZ_API_KEY: undefined, USE_DYNAMIC_CONTENT: true },
}));

beforeEach(() => {
  fixtures = {};
  for (const k of Object.keys(inserted)) delete inserted[k];
  vi.clearAllMocks();
});

// ── Image generation (real sharp) ────────────────────────────────────────────
describe('buildBrandedImage', () => {
  it('renders a 1080x1350 PNG', async () => {
    const { buildBrandedImage } = await import('../services/contentImage.js');
    const buf = await buildBrandedImage({ hook: 'Tus clientes no vuelven. Vamos a arreglarlo.', seed: 1 });
    expect(buf.length).toBeGreaterThan(1000);
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);
  });

  it('pickTemplate is deterministic per seed', async () => {
    const { pickTemplate, TEMPLATES } = await import('../services/contentImage.js');
    expect(pickTemplate(0)).toBe(TEMPLATES[0]);
    expect(pickTemplate(TEMPLATES.length)).toBe(TEMPLATES[0]);
    expect(pickTemplate(1)).toBe(TEMPLATES[1]);
  });
});

// ── Caption ──────────────────────────────────────────────────────────────────
describe('generateCaption', () => {
  it('parses hook + caption from JSON', async () => {
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ hook: 'Hook corto', caption: 'Caption largo #shopify' }) } }] });
    const { generateCaption } = await import('../services/contentCaption.js');
    const r = await generateCaption({ source: 'evergreen', rotation: 0 });
    expect(r.hook).toBe('Hook corto');
    expect(r.caption).toContain('#shopify');
  });

  it('throws on empty output', async () => {
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: '{}' } }] });
    const { generateCaption } = await import('../services/contentCaption.js');
    await expect(generateCaption({ source: 'evergreen' })).rejects.toThrow();
  });
});

// ── DM drafts ────────────────────────────────────────────────────────────────
describe('generateDmDraft', () => {
  it('caps at 500 chars and strips wrapping quotes', async () => {
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: '"' + 'a'.repeat(600) + '"' } }] });
    const { generateDmDraft } = await import('../services/dmDraftGenerator.js');
    const d = await generateDmDraft({ id: 'l1', shop_domain: 'shop.myshopify.com', instagram_handle: 'shop', pain_tags: ['no_reviews'], pain_score: 80 });
    expect(d.draft_text.length).toBeLessThanOrEqual(500);
    expect(d.draft_text.startsWith('"')).toBe(false);
  });
});

// ── Postiz gating ────────────────────────────────────────────────────────────
describe('isPostizConfigured', () => {
  it('false when env vars absent', async () => {
    const { isPostizConfigured } = await import('../lib/postiz.js');
    expect(isPostizConfigured()).toBe(false);
  });
});

// ── Content engine idempotency ───────────────────────────────────────────────
describe('runContentEngineWorkflow', () => {
  it('skips when a post already exists for today', async () => {
    fixtures.content_posts = { single: { data: { id: 'p1', status: 'scheduled' }, error: null } };
    const { runContentEngineWorkflow } = await import('../workflows/content-engine.js');
    const r = await runContentEngineWorkflow();
    expect(r.skipped).toBe('already_posted_today');
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it('dry-run generates caption + image without publishing or DB write', async () => {
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ hook: 'Vamos', caption: 'cap #x' }) } }] });
    const { runContentEngineWorkflow } = await import('../workflows/content-engine.js');
    const r = await runContentEngineWorkflow({ dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.hook).toBe('Vamos');
    expect(r.imageBytes).toBeGreaterThan(1000);
    expect(inserted.content_posts).toBeUndefined(); // no publish/DB write in dry-run
  });
});
