/**
 * Copy positioning + pause guards.
 * Guards the 2026-06-05 re-centering: daily-brief only, no over-promising,
 * outreach + nurture frozen until copy approved.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => ({ select: () => ({}) }) } }));
vi.mock('../lib/resend.js', () => ({ resend: { emails: { send: vi.fn() } } }));
vi.mock('../config/env.js', () => ({ env: { OUTREACH_DAILY_CAP: 20 } }));
vi.mock('../lib/openai.js', () => ({ openai: { chat: { completions: { create: vi.fn() } } } }));

describe('copyPositioning', () => {
  it('allowed claims include the daily brief and not forbidden features', async () => {
    const { getAllowedClaims } = await import('../services/copyPositioning.js');
    const claims = getAllowedClaims();
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.join(' ')).toMatch(/brief diario/i);
    // never describe cart recovery / welcome emails as an allowed claim
    expect(claims.join(' ')).not.toMatch(/recuperaci[oó]n de carrito|email de bienvenida/i);
  });

  it('system prompt centers the brief, bans jargon + unbuilt features', async () => {
    const { positioningSystemPrompt } = await import('../services/copyPositioning.js');
    const p = positioningSystemPrompt();
    expect(p).toMatch(/BRIEF DIARIO/);
    expect(p).toMatch(/pedido medio/);            // plain language for AOV
    expect(p).toMatch(/PROHIBIDO/);
    expect(p).toMatch(/recuperaci[oó]n de carrito/i); // listed under forbidden
    expect(p).toMatch(/App Store/);                // CTA
  });

  it('painToBrief maps tags to brief-framed lines', async () => {
    const { painToBrief } = await import('../services/copyPositioning.js');
    const lines = painToBrief(['high_aov', 'no_reviews', 'no_email_capture', 'unknown_tag']);
    expect(lines.length).toBe(3); // capped at 3, unknown dropped
    expect(lines.join(' ')).toMatch(/brief/i);
  });
});

describe('send guards (paused)', () => {
  it('outreach workflow sends nothing while paused', async () => {
    const { runOutreachWorkflow } = await import('../workflows/outreach.js');
    const r = await runOutreachWorkflow();
    expect(r.sent).toBe(0);
  });

  it('nurture workflow sends nothing while paused', async () => {
    const { runNurtureWorkflow } = await import('../workflows/nurture.js');
    const r = await runNurtureWorkflow();
    expect(r.sent).toBe(0);
  });
});
