/**
 * The page a shopper's friend opens.
 *
 * It is the only screen with no session at all, so it uses plain fetch rather
 * than the axios client — and it was written with a relative `/api/...`, which
 * the hosted frontend answers with its own index.html. Every shared link told
 * its visitor it had expired. This pins the URL it asks for.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const API = 'https://api.example.test';

const PAYLOAD = {
  mode: 'vote',
  shop: 'shop.myshopify.com',
  style: 'vintage',
  frame: 'film',
  filterIntensity: 60,
  showBranding: false,
  products: [
    // Shaped like the real payload: the server sends priceMin/priceMax and a
    // shop currency, not a formatted label. The old fixture invented
    // `priceLabel`, so every price assertion here was vacuous.
    { id: 1, handle: 'a', title: 'A snowboard', url: '/products/a', image: { url: 'https://cdn.shopify.com/a.jpg', altText: null, width: 10, height: 10 }, priceMin: '10.00', priceMax: null },
    { id: 2, handle: 'b', title: 'B snowboard', url: '/products/b', image: { url: 'https://cdn.shopify.com/b.jpg', altText: null, width: 10, height: 10 }, priceMin: '20.00', priceMax: null },
  ],
  currency: 'USD',
  votes: {},
};

async function renderAt(token: string) {
  // Loaded after the environment is set, because the page reads the base once.
  const { default: SharedPicks } = await import('../pages/picks/SharedPicks');
  return render(
    <MemoryRouter initialEntries={[`/picks/${token}`]}>
      <Routes>
        <Route path="/picks/:token" element={<SharedPicks />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('a shared list opens for the friend it was sent to', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', API);
  });

  it('asks the backend, not the page it is served from', async () => {
    const fetchMock = vi.fn(async (_url: unknown) => new Response(JSON.stringify(PAYLOAD), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await renderAt('abc123');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    // The base the rest of the app uses. A bare "/api/..." is served by the
    // static site and comes back as HTML.
    expect(url).toBe(`${API}/api/public/picks/abc123`);

    await waitFor(() => expect(screen.getByText('A snowboard')).toBeTruthy());
  });

  it('says so plainly when the link really is gone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));

    await renderAt('missing');

    await waitFor(() => expect(screen.getByText(/expired/i)).toBeTruthy());
  });

  it('puts an opaque ground behind a product that has not painted yet', async () => {
    // The film frame is near-black. A translucent tint over it resolved to
    // black, so the page a friend opens was two black rectangles until the
    // photographs arrived — and the letterboxing stayed dark afterwards.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(PAYLOAD), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await renderAt('abc123');

    const image = await screen.findByAltText('A snowboard');
    const box = image.parentElement as HTMLElement;
    expect(box.style.background).toBe('rgb(255, 253, 250)');
  });

  it('names the product in the vote button and the link', async () => {
    // Measured with an accessibility tree on the live page: two buttons both
    // read "This one", and the link's name was the image description followed
    // by "The Multi-managed Snowboard629.95 USD".
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(PAYLOAD), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await renderAt('abc123');

    await screen.findByText('A snowboard');
    expect(screen.getByRole('button', { name: 'Pick A snowboard' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pick B snowboard' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'A snowboard, 10.00 USD' })).toBeTruthy();
    // The visible price and the spoken one come from the same helper.
    expect(screen.getByText(/10\.00 USD/)).toBeTruthy();
  });
});
