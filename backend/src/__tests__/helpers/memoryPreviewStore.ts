import crypto from 'node:crypto';
import type { PreviewProject, PreviewStore } from '../../services/preview/previewStore.js';
import type { Proposal } from '../../services/preview/previewGenerator.js';
import type { DetectedProduct } from '../../services/preview/storeDetector.js';

/**
 * In-memory `PreviewStore` mirroring the SQL semantics: unique public tokens,
 * single-use claim tokens, and deletion that spares anything claimed.
 */
export class MemoryPreviewStore implements PreviewStore {
  projects: PreviewProject[] = [];
  claims: { token: string; previewId: string; proposal: string; usedAt: string | null; expiresAt: string }[] = [];
  private seq = 0;

  /** Puts a preview in the past, for the expiry tests. */
  expire(id: string): void {
    const project = this.projects.find((p) => p.id === id);
    if (project) project.expiresAt = new Date(Date.now() - 1000).toISOString();
  }

  async create(input: {
    shopDomain: string;
    sourceUrl: string;
    shopName: string | null;
    proposals: Proposal[];
    products: DetectedProduct[];
    publicToken: string;
    expiresAt: string;
  }): Promise<PreviewProject> {
    this.seq += 1;
    const project: PreviewProject = {
      id: `preview-${this.seq}`,
      shopDomain: input.shopDomain,
      sourceUrl: input.sourceUrl,
      shopName: input.shopName,
      status: 'ready',
      error: null,
      proposals: input.proposals,
      productCount: input.products.length,
      publicToken: input.publicToken,
      claimedByConnectionId: null,
      claimedProposal: null,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
    };
    this.projects.push(project);
    return project;
  }

  async getByToken(token: string): Promise<PreviewProject | null> {
    return this.projects.find((p) => p.publicToken === token) ?? null;
  }

  async findUnclaimedForShop(shopDomain: string): Promise<PreviewProject | null> {
    return (
      this.projects
        .filter(
          (p) =>
            p.shopDomain === shopDomain &&
            p.claimedByConnectionId === null &&
            Date.parse(p.expiresAt) > Date.now(),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }

  async markClaimed(id: string, connectionId: string, proposal: string): Promise<void> {
    const project = this.projects.find((p) => p.id === id);
    if (!project) return;
    project.claimedByConnectionId = connectionId;
    project.claimedProposal = proposal;
    project.status = 'claimed';
  }

  async createClaimToken(previewId: string, proposal: string, expiresAt: string): Promise<string> {
    const token = crypto.randomBytes(24).toString('base64url');
    this.claims.push({ token, previewId, proposal, usedAt: null, expiresAt });
    return token;
  }

  async consumeClaimToken(token: string): Promise<{ previewId: string; proposal: string } | null> {
    const claim = this.claims.find(
      (c) => c.token === token && c.usedAt === null && Date.parse(c.expiresAt) > Date.now(),
    );
    if (!claim) return null;
    claim.usedAt = new Date().toISOString();
    return { previewId: claim.previewId, proposal: claim.proposal };
  }

  async deleteExpired(now: string): Promise<number> {
    const cutoff = Date.parse(now);
    const doomed = this.projects.filter((p) => Date.parse(p.expiresAt) < cutoff && p.status !== 'claimed');
    this.projects = this.projects.filter((p) => !doomed.includes(p));
    this.claims = this.claims.filter((c) => Date.parse(c.expiresAt) >= cutoff);
    return doomed.length;
  }
}
