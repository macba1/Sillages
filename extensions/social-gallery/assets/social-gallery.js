/**
 * Storefront renderer for the Sillages social gallery.
 *
 * Loaded as a deferred module, so it never blocks the page. It renders a
 * skeleton immediately, fetches the published gallery, and hydrates. If the
 * gallery is not published — or the request fails — it removes its own
 * container and leaves the page exactly as it was.
 */
import {
  buildApiUrl,
  cartPayload,
  createEventQueue,
  defaultSelection,
  makeMoneyFormatter,
  optionGroups,
  priceLabel,
  readSaved,
  readSession,
  renderablePosts,
  selectVariant,
  shareLinks,
  styleClass,
  toggleSaved,
} from './gallery-core.js';

const ROOT_SELECTOR = '[data-sillages-gallery]';
const SKELETON_COUNT = 6;
const SESSION_ATTRIBUTE = '_sillages_sid';

/** Set once the gallery boots, so handlers can reach measurement and saves. */
let track = { push: () => Promise.resolve(), flush: () => Promise.resolve() };
let saved = new Set();
let shopDomain = '';
let sessionId = '';

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child) el.appendChild(child);
  }
  return el;
}

function renderSkeleton(root) {
  const grid = h('div', { class: 'sg-grid sg-grid--skeleton', 'aria-hidden': 'true' });
  for (let i = 0; i < SKELETON_COUNT; i += 1) {
    grid.appendChild(h('div', { class: 'sg-card sg-card--skeleton' }));
  }
  root.appendChild(grid);
  return grid;
}

function renderStories(gallery) {
  if (!gallery.showStories || gallery.stories.length === 0) return null;

  const rail = h('div', { class: 'sg-stories', role: 'list' });
  for (const story of gallery.stories) {
    const bubble = h('span', { class: 'sg-story__bubble' }, [
      story.imageUrl
        ? h('img', {
            class: 'sg-story__img',
            src: story.imageUrl,
            alt: '',
            loading: 'lazy',
            decoding: 'async',
          })
        : h('span', { class: 'sg-story__placeholder', 'aria-hidden': 'true' }),
    ]);
    rail.appendChild(
      h('a', { class: 'sg-story', href: story.url, role: 'listitem' }, [
        bubble,
        h('span', { class: 'sg-story__title', text: story.title }),
      ]),
    );
  }
  return rail;
}

/** Local favourite. No account, no sign-in, stored on this device only. */
function saveButton(post) {
  const button = h('button', {
    class: `sg-save${saved.has(post.id) ? ' sg-save--on' : ''}`,
    type: 'button',
    'aria-pressed': saved.has(post.id) ? 'true' : 'false',
    'aria-label': saved.has(post.id) ? `Remove ${post.title} from saved` : `Save ${post.title}`,
    text: '♥',
  });

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const result = toggleSaved(window.localStorage, shopDomain, post.id);
    saved = new Set(result.list);
    button.classList.toggle('sg-save--on', result.saved);
    button.setAttribute('aria-pressed', result.saved ? 'true' : 'false');
    button.setAttribute('aria-label', result.saved ? `Remove ${post.title} from saved` : `Save ${post.title}`);
    void track.push(result.saved ? 'save' : 'unsave', { productId: post.id });
  });

  return button;
}

/** Link, WhatsApp, and the device's own share sheet when it has one. */
function shareControls(post) {
  const links = shareLinks(post, window.location.origin, typeof navigator.share === 'function');
  const row = h('div', { class: 'sg-share', role: 'group', 'aria-label': 'Share' });

  row.appendChild(
    h('button', {
      class: 'sg-share__btn',
      type: 'button',
      text: 'Copy link',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(links.link);
          void track.push('share', { productId: post.id, meta: { channel: 'link' } });
        } catch {
          window.prompt('Copy this link', links.link);
        }
      },
    }),
  );

  row.appendChild(
    h('a', {
      class: 'sg-share__btn',
      href: links.whatsapp,
      target: '_blank',
      rel: 'noopener',
      text: 'WhatsApp',
      onclick: () => void track.push('share', { productId: post.id, meta: { channel: 'whatsapp' } }),
    }),
  );

  if (links.native) {
    row.appendChild(
      h('button', {
        class: 'sg-share__btn',
        type: 'button',
        text: 'Share',
        onclick: async () => {
          try {
            await navigator.share(links.native);
            void track.push('share', { productId: post.id, meta: { channel: 'native' } });
          } catch {
            // The shopper dismissed the sheet. Nothing to report.
          }
        },
      }),
    );
  }

  return row;
}

function renderCard(post, format, onOpen) {
  const image = post.image;
  const img = h('img', {
    class: 'sg-card__img',
    src: image.url,
    alt: image.altText || post.title,
    loading: 'lazy',
    decoding: 'async',
    width: image.width || undefined,
    height: image.height || undefined,
  });

  const card = h('article', { class: 'sg-card' }, [
    h('div', { class: 'sg-card__frame' }, [
      h('button', {
        class: 'sg-card__media',
        type: 'button',
        'aria-label': post.title,
        onclick: () => onOpen(post),
      }, [img]),
      saveButton(post),
    ]),
    h('div', { class: 'sg-card__body' }, [
      h('a', { class: 'sg-card__title', href: post.url, text: post.title }),
      h('span', { class: 'sg-card__price', text: priceLabel(post, format) }),
      post.available ? null : h('span', { class: 'sg-card__sold', text: 'Sold out' }),
    ]),
  ]);
  return card;
}

/** Bottom sheet with the variant selector and quick buy. */
function openSheet(post, gallery, format) {
  const chosen = defaultSelection(post);
  void track.push('post_open', { productId: post.id });
  let sheet;

  function close() {
    if (!sheet) return;
    document.removeEventListener('keydown', onKey);
    sheet.remove();
    document.documentElement.classList.remove('sg-locked');
  }

  function onKey(event) {
    if (event.key === 'Escape') close();
  }

  function currentVariant() {
    return selectVariant(post, chosen);
  }

  function render() {
    const variant = currentVariant();
    const groups = optionGroups(post);

    const selectors = groups.map((group) =>
      h('div', { class: 'sg-option' }, [
        h('span', { class: 'sg-option__name', text: group.name }),
        h(
          'div',
          { class: 'sg-option__values' },
          group.values.map((value) =>
            h('button', {
              class: `sg-chip${chosen[group.name] === value ? ' sg-chip--on' : ''}`,
              type: 'button',
              text: value,
              'aria-pressed': chosen[group.name] === value ? 'true' : 'false',
              onclick: () => {
                chosen[group.name] = value;
                const picked = selectVariant(post, chosen);
                void track.push('variant_select', {
                  productId: post.id,
                  variantId: picked ? picked.id : undefined,
                });
                update();
              },
            }),
          ),
        ),
      ]),
    );

    const buyable = Boolean(variant && variant.available && gallery.showQuickBuy);
    const buy = h('button', {
      class: 'sg-buy',
      type: 'button',
      disabled: !buyable,
      text: !variant ? 'Choose an option' : variant.available ? 'Add to cart' : 'Sold out',
      onclick: () => addToCart(currentVariant(), buy, post),
    });

    const body = h('div', { class: 'sg-sheet__body' }, [
      h('img', {
        class: 'sg-sheet__img',
        src: (post.image && post.image.url) || '',
        alt: post.title,
        loading: 'lazy',
        decoding: 'async',
      }),
      h('div', { class: 'sg-sheet__info' }, [
        h('h3', { class: 'sg-sheet__title', text: post.title }),
        h('span', {
          class: 'sg-sheet__price',
          text: variant ? format(variant.price) : priceLabel(post, format),
        }),
        ...selectors,
        gallery.showQuickBuy ? buy : null,
        shareControls(post),
        h('a', { class: 'sg-sheet__link', href: post.url, text: 'View full details' }),
        h('p', { class: 'sg-sheet__status', role: 'status', 'aria-live': 'polite' }),
      ]),
    ]);

    return body;
  }

  function update() {
    const fresh = render();
    sheet.querySelector('.sg-sheet__body').replaceWith(fresh);
  }

  sheet = h('div', { class: 'sg-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': post.title }, [
    h('div', { class: 'sg-sheet__scrim', onclick: close }),
    h('div', { class: 'sg-sheet__panel' }, [
      h('button', { class: 'sg-sheet__close', type: 'button', 'aria-label': 'Close', text: '×', onclick: close }),
      render(),
    ]),
  ]);

  document.addEventListener('keydown', onKey);
  document.documentElement.classList.add('sg-locked');
  document.body.appendChild(sheet);
  const closeButton = sheet.querySelector('.sg-sheet__close');
  if (closeButton) closeButton.focus();
}

async function addToCart(variant, button, post) {
  const payload = cartPayload(variant, 1);
  const status = document.querySelector('.sg-sheet__status');
  if (!payload) return;

  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Adding…';

  try {
    const response = await fetch(`${window.Shopify?.routes?.root || '/'}cart/add.js`.replace('//', '/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(String(response.status));

    button.textContent = 'Added';
    if (status) status.textContent = `${post.title} added to your cart.`;
    void track.push('add_to_cart', { productId: post.id, variantId: variant.id });
    void track.flush();
    // Carries the gallery session into the checkout, which is what lets the
    // Web Pixel credit the resulting order to the gallery rather than guess.
    void markCartSession();
    // Themes listen for this to refresh their cart drawer and count.
    document.dispatchEvent(new CustomEvent('sillages:cart:added', { detail: { variantId: variant.id } }));
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1600);
  } catch {
    button.textContent = original;
    button.disabled = false;
    if (status) status.textContent = 'We could not add that to your cart. Please try again.';
  }
}

async function markCartSession() {
  if (!sessionId) return;
  try {
    await fetch(`${window.Shopify?.routes?.root || '/'}cart/update.js`.replace('//', '/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attributes: { [SESSION_ATTRIBUTE]: sessionId } }),
    });
  } catch {
    // Attribution falls back to variant matching. Never block the purchase.
  }
}

async function boot(root) {
  const shop = root.dataset.shop;
  const apiBase = root.dataset.api;
  if (!shop || !apiBase) {
    root.remove();
    return;
  }
  shopDomain = shop;

  const skeleton = renderSkeleton(root);

  let gallery;
  try {
    const response = await fetch(buildApiUrl(apiBase, shop), {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
    });
    if (!response.ok) throw new Error(String(response.status));
    gallery = await response.json();
  } catch {
    // Nothing to show and nothing to explain to a shopper: leave no trace.
    root.remove();
    return;
  }

  const posts = renderablePosts(gallery);
  if (posts.length === 0) {
    root.remove();
    return;
  }

  const format = makeMoneyFormatter(
    root.dataset.currency || window.Shopify?.currency?.active,
    document.documentElement.lang,
  );

  // ── Session, saves and measurement ────────────────────────
  sessionId = readSession(window.localStorage);
  saved = new Set(readSaved(window.localStorage, shop));

  if (gallery.ingestToken) {
    track = createEventQueue({
      send: (events) =>
        fetch(`${apiBase.replace(/\/+$/, '')}/api/public/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          keepalive: true,
          body: JSON.stringify({ token: gallery.ingestToken, sessionId, events }),
        }),
    });
    void track.push('gallery_view', { meta: { style: gallery.style } });
    // Anything still queued when the shopper leaves is sent with keepalive.
    window.addEventListener('pagehide', () => void track.flush(), { once: true });
  }

  root.classList.add(styleClass(gallery.style));

  const fragment = document.createDocumentFragment();
  const heading = gallery.heading || root.dataset.heading;
  if (heading) fragment.appendChild(h('h2', { class: 'sg-heading', text: heading }));

  const stories = renderStories(gallery);
  if (stories) fragment.appendChild(stories);

  const grid = h('div', { class: 'sg-grid' });
  for (const post of posts) {
    grid.appendChild(renderCard(post, format, (p) => openSheet(p, gallery, format)));
  }
  fragment.appendChild(grid);

  skeleton.remove();
  root.appendChild(fragment);
  root.dataset.ready = 'true';
  observeViews(grid, posts);
}

/** Counts a product as seen only once it is actually on screen. */
function observeViews(grid, posts) {
  if (typeof IntersectionObserver !== 'function') return;

  const cards = [...grid.children];
  const seen = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = cards.indexOf(entry.target);
        const post = posts[index];
        if (!post || seen.has(post.id)) continue;
        seen.add(post.id);
        void track.push('post_view', { productId: post.id, meta: { position: index } });
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.5 },
  );

  for (const card of cards) observer.observe(card);
}

function init() {
  document.querySelectorAll(ROOT_SELECTOR).forEach((root) => {
    boot(root).catch(() => root.remove());
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
