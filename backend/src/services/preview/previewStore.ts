import crypto from 'node:crypto';
import { supabase } from '../../lib/supabase.js';
import type { Proposal } from './previewGenerator.js';
import type { DetectedProduct } from './storeDetector.js';

/** A preview is temporary by design: unclaimed demos disappear. */
export const PREVIEW_TTL_DAYS = 14;
export const CLAIM_TTL_MINUTES = 60;

export type PreviewStatus = 'pending' | 'ready' | 'failed' | 'claimed' | 'expired';

export interface PreviewProject {
  id: string;
  shopDomain: string;
  sourceUrl: string;
  shopName: string | null;
  status: PreviewStatus;
  error: string | null;
  proposals: Proposal[];
  productCount: number;
  publicToken: string;
  claimedByConnectionId: string | null;
  claimedProposal: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface PreviewStore {
  create(input: {
    shopDomain: string;
    sourceUrl: string;
    shopName: string | null;
    proposals: Proposal[];
    products: DetectedProduct[];
    publicToken: string;
    expiresAt: string;
  }): Promise<PreviewProject>;
  getByToken(token: string): Promise<PreviewProject | null>;
  /** The most recent unclaimed preview for a shop, used when it installs. */
  findUnclaimedForShop(shopDomain: string): Promise<PreviewProject | null>;
  markClaimed(id: string, connectionId: string, proposal: string): Promise<void>;
  createClaimToken(previewId: string, proposal: string, expiresAt: string): Promise<string>;
  consumeClaimToken(token: string): Promise<{ previewId: string; proposal: string } | null>;
  deleteExpired(now: string): Promise<number>;
}

function toProject(row: Record<string, unknown>): PreviewProject {
  return {
    id: row.id as string,
    shopDomain: row.shop_domain as string,
    sourceUrl: row.source_url as string,
    shopName: (row.shop_name as string | null) ?? null,
    status: row.status as PreviewStatus,
    error: (row.error as string | null) ?? null,
    proposals: (row.proposals as Proposal[]) ?? [],
    productCount: (row.product_count as number) ?? 0,
    publicToken: row.public_token as string,
    claimedByConnectionId: (row.claimed_by_connection_id as string | null) ?? null,
    claimedProposal: (row.claimed_proposal as string | null) ?? null,
    expiresAt: row.expires_at as string,
    createdAt: row.created_at as string,
  };
}

export const supabasePreviewStore: PreviewStore = {
  async create(input) {
    const { data, error } = await supabase
      .from('preview_projects')
      .insert({
        shop_domain: input.shopDomain,
        source_url: input.sourceUrl,
        shop_name: input.shopName,
        status: 'ready',
        proposals: input.proposals,
        products: input.products,
        product_count: input.products.length,
        public_token: input.publicToken,
        expires_at: input.expiresAt,
      })
      .select('*')
      .single();

    if (error) throw new Error(`creating the preview failed: ${error.message}`);
    return toProject(data);
  },

  async getByToken(token: string) {
    const { data, error } = await supabase
      .from('preview_projects')
      .select('*')
      .eq('public_token', token)
      .maybeSingle();

    if (error || !data) return null;
    return toProject(data);
  },

  async findUnclaimedForShop(shopDomain: string) {
    const { data, error } = await supabase
      .from('preview_projects')
      .select('*')
      .eq('shop_domain', shopDomain)
      .is('claimed_by_connection_id', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return toProject(data);
  },

  async markClaimed(id: string, connectionId: string, proposal: string) {
    const { error } = await supabase
      .from('preview_projects')
      .update({
        status: 'claimed',
        claimed_by_connection_id: connectionId,
        claimed_proposal: proposal,
        claimed_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw new Error(`claiming the preview failed: ${error.message}`);
  },

  async createClaimToken(previewId: string, proposal: string, expiresAt: string) {
    const token = crypto.randomBytes(24).toString('base64url');
    const { error } = await supabase.from('preview_claim_tokens').insert({
      token,
      preview_project_id: previewId,
      proposal,
      expires_at: expiresAt,
    });
    if (error) throw new Error(`creating the claim token failed: ${error.message}`);
    return token;
  },

  async consumeClaimToken(token: string) {
    // Single-use: the update only matches a token that has not been used and
    // has not expired, so a replay finds nothing.
    const { data, error } = await supabase
      .from('preview_claim_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('preview_project_id, proposal')
      .maybeSingle();

    if (error || !data) return null;
    return { previewId: data.preview_project_id as string, proposal: data.proposal as string };
  },

  async deleteExpired(now: string) {
    // A claimed preview is kept: it is the record of what a merchant chose.
    const { data, error } = await supabase
      .from('preview_projects')
      .delete()
      .lt('expires_at', now)
      .neq('status', 'claimed')
      .select('id');

    if (error) throw new Error(`removing expired previews failed: ${error.message}`);
    await supabase.from('preview_claim_tokens').delete().lt('expires_at', now);
    return data?.length ?? 0;
  },
};
