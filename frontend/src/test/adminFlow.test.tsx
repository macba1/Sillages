/**
 * Sprint 3 — the merchant's self-service journey.
 *
 * Acceptance criteria covered here:
 *   C1 choose what the gallery shows
 *   C2 choose a look
 *   C4 publish, turn off, restore a previous version
 *   C5 the four onboarding steps track real progress
 *   C6 failures are shown as something a merchant can act on
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The shell reads the signed-in account; the journey under test does not.
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
  },
}));
vi.mock('../hooks/useAccount', () => ({ useAccount: () => ({ account: { id: 'a', email: 'dev@local', full_name: 'Dev' } }) }));

const get = vi.fn();
const put = vi.fn();
const post = vi.fn();
vi.mock('../lib/api', () => ({ default: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a), post: (...a: unknown[]) => post(...a) } }));

import Collections from '../pages/gallery/Collections';
import Design from '../pages/gallery/Design';
import Publish from '../pages/gallery/Publish';
import { onboardingProgress } from '../hooks/useGallery';
import type { CatalogStatus, GalleryConfig, GalleryPreview } from '../types/gallery';

const CONFIG: GalleryConfig = {
  id: 'g1',
  collectionId: null,
  style: 'original',
  showStories: true,
  showQuickBuy: true,
  postsLimit: 60,
  heading: null,
  status: 'draft',
  version: 0,
  publishedAt: null,
  disabledAt: null,
};

const CATALOG: CatalogStatus = {
  connected: true,
  shopDomain: 'dev.myshopify.com',
  productCount: 137,
  collectionCount: 2,
  lastSync: {
    trigger: 'install',
    status: 'completed',
    startedAt: '2026-09-06T09:00:00Z',
    finishedAt: '2026-09-06T09:02:00Z',
    counts: {
      productsSeen: 137, productsUpserted: 137, productsDeleted: 0, variantsUpserted: 274,
      imagesUpserted: 274, collectionsSeen: 2, collectionsUpserted: 2, collectionsDeleted: 0,
      collectionLinksUpserted: 8,
    },
    error: null,
  },
};

const PREVIEW: GalleryPreview = {
  shop: 'dev.myshopify.com',
  active: false,
  version: 0,
  style: 'original',
  heading: null,
  showStories: true,
  showQuickBuy: true,
  stories: [{ id: 1, title: 'Summer', handle: 'summer', url: '/collections/summer', imageUrl: null }],
  posts: [
    {
      id: 10, handle: 'candle', title: 'Candle', url: '/products/candle',
      image: { url: 'https://cdn/x.jpg', altText: null, width: 800, height: 800 },
      images: [], priceMin: '20.00', priceMax: '24.00', available: true,
      variants: [{ id: 99, title: 'Default', price: '20.00', compareAtPrice: null, available: true, options: [] }],
    },
  ],
};

const COLLECTIONS = [
  { id: 'c1', shopifyId: 'gid://shopify/Collection/1', title: 'Summer', handle: 'summer', imageUrl: null, productsCount: 12 },
  { id: 'c2', shopifyId: 'gid://shopify/Collection/2', title: 'Gifts', handle: 'gifts', imageUrl: null, productsCount: 5 },
];

function mockApi(overrides: {
  config?: Partial<GalleryConfig>;
  versions?: unknown[];
  preview?: Partial<GalleryPreview>;
  catalog?: Partial<CatalogStatus>;
  storefront?: { seen: boolean; lastSeenAt: string | null } | null;
} = {}) {
  const config = { ...CONFIG, ...overrides.config };
  get.mockImplementation(async (url: string) => {
    if (url === '/api/gallery') {
      return {
        data: {
          gallery: config,
          versions: overrides.versions ?? [],
          storefront: overrides.storefront ?? null,
        },
      };
    }
    if (url === '/api/catalog/collections') return { data: { collections: COLLECTIONS } };
    if (url === '/api/catalog/status') return { data: { ...CATALOG, ...overrides.catalog } };
    if (url === '/api/gallery/preview') return { data: { ...PREVIEW, ...overrides.preview } };
    throw new Error(`unexpected GET ${url}`);
  });
  put.mockResolvedValue({ data: {} });
  post.mockResolvedValue({ data: {} });
  return config;
}

function renderPage(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  post.mockReset();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('C5: the four onboarding steps track real progress', () => {
  const PAYING = {
    canPublish: true, canUseMultipleGalleries: true, canUseAttribution: true,
    planId: 'growth' as const, status: 'active' as const, isTest: false, reason: null,
  };
  const NO_PLAN = { ...PAYING, canPublish: false, canUseAttribution: false, planId: null, status: 'none' as const, reason: 'Choose a plan to publish your gallery.' };

  it('walks from a fresh install to a published gallery', () => {
    expect(onboardingProgress(null, null, null, PAYING).currentStep).toBe(1);

    const empty = { ...CATALOG, productCount: 0 };
    expect(onboardingProgress(empty, null, null, PAYING).catalogueReady).toBe(false);

    const synced = onboardingProgress(CATALOG, CONFIG, { ...PREVIEW, posts: [] }, PAYING);
    expect(synced.catalogueReady).toBe(true);
    expect(synced.currentStep).toBe(2); // nothing to preview yet

    const previewable = onboardingProgress(CATALOG, CONFIG, PREVIEW, PAYING);
    expect(previewable.stylePreviewed).toBe(true);
    expect(previewable.currentStep).toBe(3);

    const live = onboardingProgress(CATALOG, { ...CONFIG, status: 'published', version: 1 }, PREVIEW, PAYING);
    expect(live.published).toBe(true);
    expect(live.complete).toBe(true);
  });

  it('sends a merchant to the plan before they hit the wall at publish', () => {
    // Publishing is a paid feature. Walking someone through four steps and then
    // refusing at the last one is how a setup gets abandoned.
    const ready = onboardingProgress(CATALOG, CONFIG, PREVIEW, NO_PLAN);
    expect(ready.planChosen).toBe(false);
    expect(ready.currentStep).toBe(4);
    expect(ready.complete).toBe(false);
  });

  it('does not tell a paying merchant to pay again when the plan cannot be read', () => {
    // Unknown is not the same as absent.
    const unknown = onboardingProgress(CATALOG, CONFIG, PREVIEW, null);
    expect(unknown.planChosen).toBe(true);
    expect(unknown.currentStep).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('C1: choosing what the gallery shows', () => {
  it('lists every product and each collection, with the current choice selected', async () => {
    mockApi();
    renderPage(<Collections />);

    await screen.findByText('Every product');
    expect(screen.getByText('Summer')).toBeInTheDocument();
    expect(screen.getByText('Gifts')).toBeInTheDocument();
    expect(screen.getByText('137')).toBeInTheDocument();

    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios[0].checked).toBe(true); // "Every product" is the default
  });

  it('saves the collection the merchant picks', async () => {
    mockApi();
    renderPage(<Collections />);
    await screen.findByText('Summer');

    fireEvent.click(screen.getAllByRole('radio')[1]);

    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/gallery', { collectionId: 'c1' }));
  });

  it('offers a manual sync and reports a failed one', async () => {
    mockApi({ catalog: { lastSync: { ...CATALOG.lastSync!, status: 'failed', error: 'Shopify timed out' } } });
    renderPage(<Collections />);

    expect(await screen.findByText(/The last sync failed: Shopify timed out/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/catalog/sync'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('C2: choosing a look', () => {
  it('offers exactly the three styles and saves the choice', async () => {
    mockApi();
    renderPage(<Design />);

    await screen.findByText('Original');
    expect(screen.getByText('Warm')).toBeInTheDocument();
    expect(screen.getByText('Film')).toBeInTheDocument();

    const styleRadios = screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).name === 'gallery-style');
    expect(styleRadios).toHaveLength(3);

    fireEvent.click(styleRadios[1]);
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/gallery', { style: 'warm' }));
  });

  it('saves a heading only when it changed', async () => {
    mockApi();
    renderPage(<Design />);
    await screen.findByText('Original');

    const save = screen.getByRole('button', { name: 'Save heading' });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Heading above the gallery'), { target: { value: 'Shop the look' } });
    expect(save).not.toBeDisabled();

    fireEvent.click(save);
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/gallery', { heading: 'Shop the look' }));
  });

  it('lets quick buy and stories be turned off', async () => {
    mockApi();
    renderPage(<Design />);
    await screen.findByText('Original');

    fireEvent.click(screen.getByLabelText(/Show collections as stories/));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/gallery', { showStories: false }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('C4: publish, turn off, restore', () => {
  it('publishes in one click', async () => {
    mockApi();
    renderPage(<Publish />);

    const button = await screen.findByRole('button', { name: 'Publish' });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/gallery/publish'));
  });

  it('refuses to publish an empty gallery and says why', async () => {
    mockApi({ preview: { posts: [] } });
    renderPage(<Publish />);

    expect(await screen.findByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(screen.getByText(/There is nothing to publish yet/)).toBeInTheDocument();
  });

  it('shows the live state and offers turning it off', async () => {
    mockApi({ config: { status: 'published', version: 2 } });
    renderPage(<Publish />);

    expect(await screen.findByText('Live')).toBeInTheDocument();
    expect(screen.getByText(/Live on your store — version 2/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/gallery/disable'));
  });

  it('restores a previous version, but never offers to restore the current one', async () => {
    mockApi({
      config: { status: 'published', version: 2 },
      versions: [
        { version: 2, publishedAt: '2026-09-06T10:00:00Z', snapshot: { style: 'film', heading: 'Second', collectionId: null } },
        { version: 1, publishedAt: '2026-09-05T10:00:00Z', snapshot: { style: 'original', heading: 'First', collectionId: null } },
      ],
    });
    renderPage(<Publish />);

    await screen.findByText('Version 1');
    const restore = screen.getAllByRole('button', { name: 'Restore' });
    expect(restore).toHaveLength(1); // only version 1

    fireEvent.click(restore[0]);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/gallery/revert', { version: 1 }));
  });

  it('explains the one-time theme step instead of leaving it to support', async () => {
    mockApi();
    renderPage(<Publish />);
    expect(await screen.findByText(/Add block/)).toBeInTheDocument();
    expect(screen.getByText(/Your theme code is never edited/)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('C6: failures are visible and actionable', () => {
  it('explains a failed load rather than showing an empty screen', async () => {
    get.mockRejectedValue({ response: { status: 500 } });
    renderPage(<Collections />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load your gallery/i);
  });

  it('surfaces the server message when publishing is refused', async () => {
    mockApi();
    post.mockRejectedValue({ response: { status: 400, data: { error: 'There is no gallery to publish yet' } } });
    renderPage(<Publish />);

    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('There is no gallery to publish yet');
  });

  it('turns a rate limit into plain advice', async () => {
    mockApi();
    post.mockRejectedValue({ response: { status: 429 } });
    renderPage(<Collections />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sync now' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Wait a minute and try again/);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// Review follow-up: the interface must never show a state with no real process
// behind it.
describe('the interface never claims more than it knows', () => {
  it('says "Published", not "Live", until the storefront has actually loaded it', async () => {
    mockApi({
      config: { status: 'published', version: 1 },
      storefront: { seen: false, lastSeenAt: null },
    });
    renderPage(<Publish />);

    expect(await screen.findByText('Published')).toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    expect(screen.getByText(/not seen on your storefront yet/)).toBeInTheDocument();
    // And it says what to do about it.
    expect(screen.getByText(/the block has not been added to your theme/)).toBeInTheDocument();
  });

  it('says "Live" once the storefront has loaded it', async () => {
    mockApi({
      config: { status: 'published', version: 1 },
      storefront: { seen: true, lastSeenAt: '2026-09-07T10:00:00Z' },
    });
    renderPage(<Publish />);

    expect(await screen.findByText('Live')).toBeInTheDocument();
    expect(screen.queryByText(/not seen on your storefront yet/)).not.toBeInTheDocument();
  });

  it('reports a sync whose process died as stopped, not as in progress', async () => {
    mockApi({
      catalog: {
        lastSync: {
          trigger: 'manual',
          status: 'failed',
          stale: true,
          startedAt: '2026-09-07T09:00:00Z',
          finishedAt: null,
          counts: CATALOG.lastSync!.counts,
          error: 'The last sync stopped responding. Run it again.',
        },
      },
    });
    renderPage(<Collections />);

    expect(await screen.findByText('Stopped')).toBeInTheDocument();
    expect(screen.queryByText('In progress')).not.toBeInTheDocument();
    expect(screen.getByText(/stopped responding/)).toBeInTheDocument();
  });
});
