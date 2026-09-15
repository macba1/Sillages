import { randomBytes } from 'node:crypto';
import { supabase } from '../../lib/supabase.js';

/**
 * Shareable picks, and the informal vote between them.
 *
 * A shopper saves a few things, presses one button, and gets a link to send.
 * That link is the whole feature: it turns a private decision into traffic the
 * merchant did not pay for.
 *
 * What is deliberately absent: names, emails, accounts, comments, messages,
 * profiles. A list is a set of product ids and a token; a vote is a product id
 * and a random string the voter's own browser made up. There is nowhere to put
 * a person, which is the only way to be sure one never ends up here.
 */

/** Enough entropy that guessing a live list is not a strategy. */
const TOKEN_BYTES = 24;

/** A shopper choosing between forty things is not choosing. */
export const MAX_PICKS = 20;
export const MIN_PICKS_FOR_VOTE = 2;

export type PicksMode = 'list' | 'vote';

export interface PicksRecord {
  token: string;
  connectionId: string;
  productIds: number[];
  mode: PicksMode;
  createdAt: string;
  expiresAt: string;
}

export interface PicksStore {
  create(record: Omit<PicksRecord, 'createdAt' | 'expiresAt'>): Promise<PicksRecord | null>;
  getByToken(token: string): Promise<PicksRecord | null>;
  softDelete(token: string): Promise<boolean>;
  castVote(token: string, productId: number, voterKey: string): Promise<boolean>;
  tally(token: string): Promise<Record<number, number>>;
}

export function newPicksToken(bytes: () => Buffer = () => randomBytes(TOKEN_BYTES)): string {
  return bytes().toString('base64url').slice(0, 32);
}

/**
 * Normalises whatever the browser sent into a list we are willing to store.
 *
 * Returns null rather than a corrected value when the request is not one a
 * real shopper could have made: an empty set, or a vote between fewer than two
 * things, is a bug or a probe, and answering it with a link would be worse
 * than refusing.
 */
export function normalisePicks(
  rawIds: unknown,
  rawMode: unknown,
): { productIds: number[]; mode: PicksMode } | null {
  if (!Array.isArray(rawIds)) return null;

  const seen = new Set<number>();
  for (const value of rawIds) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    seen.add(id);
    if (seen.size >= MAX_PICKS) break;
  }

  const productIds = [...seen];
  if (productIds.length === 0) return null;

  const mode: PicksMode = rawMode === 'vote' ? 'vote' : 'list';
  if (mode === 'vote' && productIds.length < MIN_PICKS_FOR_VOTE) return null;

  return { productIds, mode };
}

interface PicksRow {
  token: string;
  connection_id: string;
  product_ids: number[] | string[];
  mode: string;
  created_at: string;
  expires_at: string;
}

function toRecord(row: PicksRow): PicksRecord {
  return {
    token: row.token,
    connectionId: row.connection_id,
    // Postgres bigint[] arrives as strings through PostgREST; a product id is
    // comfortably inside Number's safe range, so this is lossless.
    productIds: (row.product_ids as unknown[]).map((v) => Number(v)).filter((n) => Number.isSafeInteger(n)),
    mode: row.mode === 'vote' ? 'vote' : 'list',
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export const supabasePicksStore: PicksStore = {
  async create(record) {
    const { data, error } = await supabase
      .from('gallery_picks')
      .insert({
        token: record.token,
        connection_id: record.connectionId,
        product_ids: record.productIds,
        mode: record.mode,
      })
      .select('*')
      .single();

    if (error || !data) return null;
    return toRecord(data as PicksRow);
  },

  async getByToken(token) {
    const { data, error } = await supabase
      .from('gallery_picks')
      .select('*')
      .eq('token', token)
      .is('deleted_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error || !data) return null;
    return toRecord(data as PicksRow);
  },

  async softDelete(token) {
    const { error } = await supabase
      .from('gallery_picks')
      .update({ deleted_at: new Date().toISOString() })
      .eq('token', token);
    return !error;
  },

  async castVote(token, productId, voterKey) {
    const list = await this.getByToken(token);
    if (!list || list.mode !== 'vote') return false;
    // A vote for something that is not on the list is not a vote.
    if (!list.productIds.includes(productId)) return false;

    const { data: row } = await supabase
      .from('gallery_picks')
      .select('id')
      .eq('token', token)
      .maybeSingle();
    if (!row) return false;

    // One row per browser per list: changing your mind replaces the row rather
    // than stuffing the ballot.
    const { error } = await supabase
      .from('gallery_pick_votes')
      .upsert(
        { pick_id: (row as { id: string }).id, product_id: productId, voter_key: voterKey },
        { onConflict: 'pick_id,voter_key' },
      );
    return !error;
  },

  async tally(token) {
    const { data: row } = await supabase
      .from('gallery_picks')
      .select('id')
      .eq('token', token)
      .maybeSingle();
    if (!row) return {};

    const { data, error } = await supabase
      .from('gallery_pick_votes')
      .select('product_id')
      .eq('pick_id', (row as { id: string }).id);

    if (error || !data) return {};

    const counts: Record<number, number> = {};
    for (const vote of data as { product_id: number | string }[]) {
      const id = Number(vote.product_id);
      counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  },
};
