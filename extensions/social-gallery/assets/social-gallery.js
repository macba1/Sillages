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
  defaultSelection,
  makeMoneyFormatter,
  optionGroups,
  priceLabel,
  renderablePosts,
  selectVariant,
  styleClass,
} from './gallery-core.js';

const ROOT_SELECTOR = '[data-sillages-gallery]';
const SKELETON_COUNT = 6;

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
    h('button', {
      class: 'sg-card__media',
      type: 'button',
      'aria-label': post.title,
      onclick: () => onOpen(post),
    }, [img]),
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

async function boot(root) {
  const shopDomain = root.dataset.shop;
  const apiBase = root.dataset.api;
  if (!shopDomain || !apiBase) {
    root.remove();
    return;
  }

  const skeleton = renderSkeleton(root);

  let gallery;
  try {
    const response = await fetch(buildApiUrl(apiBase, shopDomain), {
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
