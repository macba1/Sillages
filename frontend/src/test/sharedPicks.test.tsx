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

const API = 'https://api.example.test/api';

const PAYLOAD = {
  mode: 'vote',
  shop: 'shop.myshopify.com',
  style: 'vintage',
  frame: 'film',
  filterIntensity: 60,
  showBranding: false,
  products: [
    { id: 1, handle: 'a', title: 'A snowboard', url: '/products/a', image: { url: 'https://cdn.shopify.com/a.jpg', altText: null, width: 10, height: 10 }, priceLabel: '$10.00' },
    { id: 2, handle: 'b', title: 'B snowboard', url: '/products/b', image: { url: 'https://cdn.shopify.com/b.jpg', altText: null, width: 10, height: 10 }, priceLabel: '$20.00' },
  ],
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
    expect(url).toBe(`${API}/public/picks/abc123`);

    await waitFor(() => expect(screen.getByText('A snowboard')).toBeTruthy());
  });

  it('says so plainly when the link really is gone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));

    await renderAt('missing');

    await waitFor(() => expect(screen.getByText(/expired/i)).toBeTruthy());
  });
});
