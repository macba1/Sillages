/**
 * Storefront renderer for the Sillages social gallery.
 *
 * Loaded as a deferred module, so it never blocks the page. It renders a
 * skeleton immediately, fetches the published gallery, and hydrates. If the
 * gallery is not published — or the request fails — it removes its own
 * container and leaves the page exactly as it was.
 *
 * Everything a shopper does here is local: a save is a product id in this
 * browser's storage, a session is a random string. Nothing identifies anybody.
 */
import {
  availableValues,
  buildApiUrl,
  cartPayload,
  createEventQueue,
  defaultSelection,
  filterAmount,
  frameClass,
  layoutClass,
  makeMoneyFormatter,
  optionGroups,
  priceLabel,
  readSaved,
  readSession,
  renderablePosts,
  savedPosts,
  selectVariant,
  shareCardUrl,
  shareLinks,
  styleClass,
  toggleSaved,
} from './gallery-core.js';

const ROOT_SELECTOR = '[data-sillages-gallery]';
const SKELETON_COUNT = 6;
const SESSION_ATTRIBUTE = '_sillages_sid';
const STORY_MS = 4200;

/** Set once the gallery boots, so handlers can reach measurement and saves. */
let track = { push: () => Promise.resolve(), flush: () => Promise.resolve() };
let saved = new Set();
let shopDomain = '';
let sessionId = '';
let apiRoot = '';
let onSavedChange = () => {};

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

/**
 * A word, then gone.
 *
 * Saving has to feel instant and weightless. A dialog would interrupt exactly
 * the browsing the gallery exists to encourage, so the confirmation is a line
 * at the bottom of the screen with a way back out of the decision.
 */
let toastTimer = null;
function toast(message, undo) {
  document.querySelector('.sg-toast')?.remove();
  if (toastTimer) clearTimeout(toastTimer);

  const node = h('div', { class: 'sg-toast', role: 'status', 'aria-live': 'polite' }, [
    h('span', { text: message }),
    undo ? h('button', { class: 'sg-toast__undo', type: 'button', text: 'Undo', onclick: () => { node.remove(); undo(); } }) : null,
  ]);
  document.body.appendChild(node);
  toastTimer = setTimeout(() => node.remove(), 3200);
}

// ── Save ────────────────────────────────────────────────────────

function applySaveState(button, post, isSaved) {
  button.classList.toggle('sg-save--on', isSaved);
  button.setAttribute('aria-pressed', isSaved ? 'true' : 'false');
  button.setAttribute('aria-label', isSaved ? `Remove ${post.title} from saved` : `Save ${post.title}`);
}

function setSaved(post, next) {
  const current = saved.has(post.id);
  if (current === next) return current;
  const result = toggleSaved(window.localStorage, shopDomain, post.id);
  saved = new Set(result.list);
  void track.push(result.saved ? 'save' : 'unsave', { productId: post.id });
  onSavedChange();
  document.querySelectorAll(`[data-sg-save="${post.id}"]`).forEach((node) => applySaveState(node, post, result.saved));
  return result.saved;
}

/** Local favourite. No account, no sign-in, stored on this device only. */
function saveButton(post) {
  const button = h('button', {
    class: `sg-save${saved.has(post.id) ? ' sg-save--on' : ''}`,
    type: 'button',
    'data-sg-save': post.id,
  }, [h('span', { class: 'sg-save__mark', text: '♥', 'aria-hidden': 'true' })]);
  applySaveState(button, post, saved.has(post.id));

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    event.preventDefault();
    const isSaved = setSaved(post, !saved.has(post.id));
    if (isSaved) toast('Saved to your picks', () => setSaved(post, false));
  });

  return button;
}

// ── Share ───────────────────────────────────────────────────────

/**
 * Link, WhatsApp, the device's own sheet, and a card worth sending.
 *
 * The card is the point: a bare link is not something anybody wants to send a
 * friend. It is drawn by the server from the shop's own photograph, and a
 * failure to draw it hides the card rather than breaking sharing.
 */
function shareControls(post, gallery) {
  const links = shareLinks(post, window.location.origin, typeof navigator.share === 'function');
  const cardHref = shareCardUrl(apiRoot, shopDomain, post.id);
  const wrap = h('div', { class: 'sg-sheet__info' });

  // The frame keeps its 9:16 box whether or not the card arrives. Removing the
  // image on failure used to change the panel's height, which re-centred it
  // mid-tap: the shopper's finger landed on whatever slid under it.
  const preview = h('img', {
    class: 'sg-share__card',
    alt: '',
    decoding: 'async',
    src: cardHref,
  });
  const frame = h('div', { class: 'sg-share__frame' }, [preview]);
  const hint = h('p', { class: 'sg-share__hint', text: `A card to send a friend. ${gallery.shareTagline}` });
  preview.addEventListener('error', () => {
    frame.classList.add('sg-share__frame--empty');
    preview.remove();
    hint.textContent = 'The card could not be drawn. The link below still works.';
  });
  wrap.appendChild(frame);
  wrap.appendChild(hint);

  const shared = (channel) => void track.push('share', { productId: post.id, meta: { channel } });
  const row = h('div', { class: 'sg-share', role: 'group', 'aria-label': 'Share' });

  row.appendChild(
    h('button', {
      class: 'sg-share__btn',
      type: 'button',
      text: 'Copy link',
      onclick: async () => {
        // window.prompt used to be the fallback here. It blocks the page until
        // it is dismissed, which on a storefront is worse than no copy at all.
        if (await copyOrShow(links.url, wrap)) toast('Link copied');
        shared('link');
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
      onclick: () => shared('whatsapp'),
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
            shared('native');
          } catch {
            // The shopper closed the sheet. Nothing to report and nothing to fix.
          }
        },
      }),
    );
  }

  // Downloading is the honest way to reach a feed the browser cannot post to.
  // Nothing here claims to publish anything on the shopper's behalf.
  row.appendChild(
    h('button', {
      class: 'sg-share__btn',
      type: 'button',
      text: 'Save card',
      onclick: async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        // `download` on a cross-origin link is ignored: the browser navigated
        // to the image instead of saving it, while the toast claimed the card
        // had been saved. Fetching it first makes the file genuinely local, so
        // the download is real and the message is true.
        const saved = await downloadCard(cardHref, `${post.handle || 'product'}.jpg`);
        button.disabled = false;
        shared('other');
        toast(
          saved
            ? 'Card saved. Add it to a story and the link goes with it.'
            : 'Card opened. Press and hold it to save.',
        );
      },
    }),
  );

  wrap.appendChild(row);
  return wrap;
}

/**
 * Puts a link on the clipboard, or on the screen.
 *
 * `window.prompt` was the old fallback. It blocks the page until dismissed,
 * which on someone else's storefront is unacceptable, so a refused clipboard
 * now shows the link in place instead: selectable, readable, dismissible.
 */
async function copyOrShow(url, container) {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    showLink(url, container, 'Copy this link and send it');
    return false;
  }
}

/**
 * The link, kept on screen.
 *
 * A created link used to exist only in the clipboard and in a toast that was
 * gone in three seconds. Anyone who looked away lost it with no way back.
 */
function showLink(url, container, label) {
  container.querySelector('.sg-linkout')?.remove();

  const field = h('input', {
    class: 'sg-linkout__url',
    type: 'text',
    readonly: true,
    value: url,
    'aria-label': 'Link',
  });
  const row = h('div', { class: 'sg-linkout' }, [
    h('p', { class: 'sg-linkout__label', text: label }),
    field,
    h('div', { class: 'sg-linkout__row' }, [
      h('button', {
        class: 'sg-share__btn',
        type: 'button',
        text: 'Copy',
        onclick: async () => {
          field.select();
          try {
            await navigator.clipboard.writeText(url);
            toast('Link copied');
          } catch {
            // Already on screen and selected; there is nothing left to offer.
          }
        },
      }),
      h('a', { class: 'sg-share__btn', href: url, target: '_blank', rel: 'noopener', text: 'Open' }),
    ]),
  ]);
  container.appendChild(row);
  field.focus();
  field.select();
  return row;
}

/**
 * Saves the card as a file the shopper actually has.
 *
 * Returns false when the browser will not hand over a file — mobile Safari
 * among them — and then the card is opened so it can be saved by hand. The
 * caller says which of the two happened; neither claims to be the other.
 */
async function downloadCard(url, filename) {
  try {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) throw new Error(String(response.status));
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = h('a', { href, download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
    return true;
  } catch {
    window.open(url, '_blank', 'noopener');
    return false;
  }
}

// ── Quick buy ───────────────────────────────────────────────────

let sheet = null;
/** Where focus goes when an overlay closes: the control that opened it. */
let returnFocusTo = null;

function closeSheet() {
  if (!sheet) return;
  sheet.remove();
  sheet = null;
  document.documentElement.classList.remove('sg-locked');
  document.removeEventListener('keydown', onSheetKey);
  if (returnFocusTo && returnFocusTo.isConnected) returnFocusTo.focus();
  returnFocusTo = null;
}

function onSheetKey(event) {
  if (event.key === 'Escape') closeSheet();
}

function openSheet(post, gallery, format, context) {
  closeSheet();
  const chosen = defaultSelection(post);
  const currentVariant = () => selectVariant(post, chosen);

  function render() {
    const variant = currentVariant();
    const groups = optionGroups(post);

    const selectors = groups.map((group) => {
      const usable = availableValues(post, group.name, chosen);
      return h('div', { class: 'sg-option' }, [
        h('span', { class: 'sg-option__name', text: group.name }),
        h(
          'div',
          { class: 'sg-option__values' },
          group.values.map((value) => {
            const gone = !usable.has(value);
            return h('button', {
              class: `sg-chip${chosen[group.name] === value ? ' sg-chip--on' : ''}${gone ? ' sg-chip--gone' : ''}`,
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
            });
          }),
        ),
      ]);
    });

    const buyable = Boolean(variant && variant.available && gallery.showQuickBuy);
    // The label is a child element: see .sg-buy in social-gallery.css, where the
    // button's fill is the theme's ink and only the label may override colour.
    const buy = h(
      'button',
      {
        class: 'sg-buy',
        type: 'button',
        disabled: !buyable,
        onclick: () => addToCart(currentVariant(), buy, post),
      },
      [
        h('span', {
          class: 'sg-buy__label',
          text: !variant ? 'Choose an option' : variant.available ? 'Add to cart' : 'Sold out',
        }),
      ],
    );

    const price = h('span', { class: 'sg-sheet__price' }, [
      h('span', { text: variant ? format(variant.price) : priceLabel(post, format) }),
      variant && variant.compareAtPrice && Number(variant.compareAtPrice) > Number(variant.price)
        ? h('span', { class: 'sg-sheet__was', text: format(variant.compareAtPrice) })
        : null,
    ]);

    const body = h('div', { class: 'sg-sheet__body' }, [
      h('div', { class: 'sg-card__frame' }, [
        h('img', {
          class: 'sg-sheet__img',
          src: (post.image && post.image.url) || '',
          alt: post.title,
          loading: 'lazy',
          decoding: 'async',
        }),
        saveButton(post),
      ]),
      h('div', { class: 'sg-sheet__info' }, [
        h('h3', { class: 'sg-sheet__title', text: post.title }),
        price,
        ...selectors,
        gallery.showQuickBuy ? buy : null,
        shareControls(post, gallery),
        h('a', { class: 'sg-sheet__link', href: post.url, text: 'View full details' }),
        // Browsing is the habit worth keeping. Closing one product should hand
        // the shopper the next one, not the page they were on.
        context && context.next
          ? h('button', { class: 'sg-sheet__next', type: 'button', text: 'Next product →', onclick: () => context.next() })
          : null,
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
    h('div', { class: 'sg-sheet__scrim', onclick: closeSheet }),
    h('div', { class: 'sg-sheet__panel' }, [
      h('button', { class: 'sg-sheet__close', type: 'button', 'aria-label': 'Close', text: '×', onclick: closeSheet }),
      render(),
    ]),
  ]);

  document.addEventListener('keydown', onSheetKey);
  document.documentElement.classList.add('sg-locked');
  const opener = document.activeElement;
  document.body.appendChild(sheet);
  sheet.querySelector('.sg-sheet__close')?.focus();
  returnFocusTo = opener instanceof HTMLElement && opener.isConnected ? opener : null;
}

async function addToCart(variant, button, post) {
  const payload = cartPayload(variant, 1);
  const status = document.querySelector('.sg-sheet__status');
  if (!payload) return;

  // Write to the label, never to the button: replacing the button's text
  // content would remove the .sg-buy__label element, and the label is the only
  // thing standing between the text and the same-colour fill behind it.
  const label = button.querySelector('.sg-buy__label') || button;
  button.disabled = true;
  const original = label.textContent;
  label.textContent = 'Adding…';

  try {
    const response = await fetch(`${window.Shopify?.routes?.root || '/'}cart/add.js`.replace('//', '/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(String(response.status));

    label.textContent = 'Added';
    if (status) status.textContent = `${post.title} added to your cart.`;
    void track.push('add_to_cart', { productId: post.id, variantId: variant.id });
    void track.flush();
    // Carries the gallery session into the cart. Nothing reads it back today —
    // the Web Pixel is not shipped and the app does not request read_orders —
    // but it costs nothing and is what attribution would be built on.
    void markCartSession();
    // Themes listen for this to refresh their cart drawer and count.
    document.dispatchEvent(new CustomEvent('sillages:cart:added', { detail: { variantId: variant.id } }));
    setTimeout(() => {
      label.textContent = original;
      button.disabled = false;
    }, 1600);
  } catch {
    label.textContent = original;
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
    // Never block the purchase over a cart attribute.
  }
}

// ── Story viewer ────────────────────────────────────────────────

/**
 * A full-screen reader for one collection.
 *
 * The rules it follows are the ones people already expect: tap the right half
 * to go on, the left to go back, swipe down to leave, arrows and Escape on a
 * keyboard. It pauses whenever the shopper is doing something — reading a
 * variant, or simply on another tab — because a timer that advances underneath
 * an interaction is how these things become annoying.
 */
function openViewer(story, posts, gallery, format) {
  if (posts.length === 0) return;

  let index = 0;
  let timer = null;
  let startedAt = 0;
  let paused = false;
  let completed = false;

  const bars = h('div', { class: 'sg-viewer__bars' });
  const fills = posts.map(() => h('span', { class: 'sg-viewer__fill' }));
  for (const fill of fills) bars.appendChild(h('span', { class: 'sg-viewer__bar' }, [fill]));

  const img = h('img', { class: 'sg-viewer__img', alt: '', decoding: 'async' });
  const title = h('h3', { class: 'sg-viewer__title' });
  const price = h('span', { class: 'sg-viewer__price' });
  const actions = h('div', { class: 'sg-viewer__actions' });

  const stage = h('div', { class: 'sg-viewer__stage' }, [
    img,
    h('button', { class: 'sg-viewer__zone sg-viewer__zone--prev', type: 'button', 'aria-label': 'Previous', onclick: () => go(-1) }),
    h('button', { class: 'sg-viewer__zone sg-viewer__zone--next', type: 'button', 'aria-label': 'Next', onclick: () => go(1) }),
    h('button', { class: 'sg-viewer__arrow sg-viewer__arrow--prev', type: 'button', 'aria-label': 'Previous', text: '‹', onclick: () => go(-1) }),
    h('button', { class: 'sg-viewer__arrow sg-viewer__arrow--next', type: 'button', 'aria-label': 'Next', text: '›', onclick: () => go(1) }),
  ]);

  const viewer = h('div', {
    class: `sg-viewer ${styleClass(gallery.style)}`,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': `${story.title} stories`,
  }, [
    bars,
    h('div', { class: 'sg-viewer__head' }, [
      h('span', { class: 'sg-viewer__collection', text: story.title }),
      h('button', { class: 'sg-viewer__close', type: 'button', 'aria-label': 'Close', text: '×', onclick: close }),
    ]),
    stage,
    h('div', { class: 'sg-viewer__foot' }, [title, price, actions]),
  ]);
  viewer.style.setProperty('--sg-k', String(filterAmount(gallery.filterIntensity)));

  function paint() {
    const post = posts[index];
    img.src = (post.image && post.image.url) || '';
    img.alt = post.title;
    title.textContent = post.title;
    price.textContent = priceLabel(post, format);

    actions.replaceChildren(
      saveButton(post),
      h('button', {
        class: 'sg-viewer__ghost',
        type: 'button',
        text: 'Share',
        onclick: () => { pause(); openSheet(post, gallery, format); },
      }),
      h('button', {
        class: 'sg-viewer__shop',
        type: 'button',
        text: gallery.showQuickBuy ? 'Shop this' : 'View product',
        onclick: () => {
          pause();
          void track.push('post_open', { productId: post.id });
          openSheet(post, gallery, format);
        },
      }),
    );

    fills.forEach((fill, i) => {
      fill.style.width = i < index ? '100%' : '0%';
    });
    void track.push('post_view', { productId: post.id, meta: { position: index } });
  }

  function advance() {
    startedAt = Date.now();
    const fill = fills[index];
    fill.style.transition = 'none';
    fill.style.width = '0%';
    // Next frame, so the reset is painted before the animation starts.
    requestAnimationFrame(() => {
      fill.style.transition = `width ${STORY_MS}ms linear`;
      fill.style.width = '100%';
    });
    timer = setTimeout(() => go(1), STORY_MS);
  }

  function pause() {
    if (paused) return;
    paused = true;
    if (timer) clearTimeout(timer);
    const fill = fills[index];
    const elapsed = Math.min(1, (Date.now() - startedAt) / STORY_MS);
    fill.style.transition = 'none';
    fill.style.width = `${elapsed * 100}%`;
  }

  function resume() {
    if (!paused) return;
    paused = false;
    advance();
  }

  function go(step) {
    if (timer) clearTimeout(timer);
    const next = index + step;
    if (next < 0) return;
    if (next >= posts.length) {
      completed = true;
      close();
      return;
    }
    index = next;
    paused = false;
    paint();
    advance();
  }

  function onKey(event) {
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowRight') go(1);
    else if (event.key === 'ArrowLeft') go(-1);
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') pause();
    else if (!sheet) resume();
  }

  function close() {
    if (timer) clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisibility);
    viewer.remove();
    document.documentElement.classList.remove('sg-locked');
    // Back where they were, not at the top of the document.
    if (returnFocusTo && returnFocusTo.isConnected) returnFocusTo.focus();
    returnFocusTo = null;
    void track.push('story_close', {
      meta: { position: index, completed: completed || index >= posts.length - 1 },
    });
  }

  // Swipe: down closes, left and right move. Deliberately generous thresholds
  // so a scroll attempt does not dismiss the viewer by accident.
  let touch = null;
  stage.addEventListener('touchstart', (event) => {
    touch = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    pause();
  }, { passive: true });
  stage.addEventListener('touchend', (event) => {
    if (!touch) return;
    const dx = event.changedTouches[0].clientX - touch.x;
    const dy = event.changedTouches[0].clientY - touch.y;
    touch = null;
    if (dy > 90 && Math.abs(dy) > Math.abs(dx)) { close(); return; }
    if (Math.abs(dx) > 60) { go(dx < 0 ? 1 : -1); return; }
    resume();
  }, { passive: true });

  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  document.documentElement.classList.add('sg-locked');
  document.body.appendChild(viewer);
  // Without this a keyboard user opening a story is still focused on the page
  // behind a full-screen overlay: Escape works, Tab goes somewhere invisible.
  const opener = document.activeElement;
  viewer.querySelector('.sg-viewer__close')?.focus();
  returnFocusTo = opener instanceof HTMLElement ? opener : null;

  void track.push('story_open', { meta: { position: 0 } });
  paint();
  advance();
}

// ── Saved panel ─────────────────────────────────────────────────

function openSavedPanel(gallery, posts, format) {
  closeSheet();
  const list = savedPosts(posts, saved);

  const body = h('div', { class: 'sg-sheet__body' }, [
    h('div', { class: 'sg-sheet__info' }, [
      h('h3', { class: 'sg-sheet__title', text: 'Your picks' }),
      list.length === 0
        ? h('p', { class: 'sg-saved__empty', text: 'Nothing saved yet. Tap the heart on anything you like.' })
        : h(
            'ul',
            { class: 'sg-saved__list' },
            list.map((post) =>
              h('li', { class: 'sg-saved__row' }, [
                h('img', {
                  class: 'sg-saved__thumb',
                  src: (post.image && post.image.url) || '',
                  alt: '',
                  loading: 'lazy',
                  decoding: 'async',
                  onclick: () => openSheet(post, gallery, format),
                }),
                h('div', {}, [
                  h('div', { class: 'sg-saved__name', text: post.title }),
                  h('div', { class: 'sg-saved__price', text: priceLabel(post, format) }),
                ]),
                h('button', {
                  class: 'sg-saved__remove',
                  type: 'button',
                  'aria-label': `Remove ${post.title}`,
                  text: '×',
                  onclick: (event) => {
                    event.currentTarget.closest('.sg-saved__row')?.remove();
                    setSaved(post, false);
                  },
                }),
              ]),
            ),
          ),
      list.length > 0
        ? h('div', { class: 'sg-saved__actions' }, [
            gallery.features && gallery.features.sharedLists
              ? h('button', { class: 'sg-buy', type: 'button', onclick: () => sharePicks(list, false) }, [
                  h('span', { class: 'sg-buy__label', text: 'Share my picks' }),
                ])
              : null,
            gallery.features && gallery.features.friendVotes && list.length >= 2
              ? h('button', { class: 'sg-secondary', type: 'button', text: 'Ask your friends', onclick: () => sharePicks(list, true) })
              : null,
            h('button', {
              class: 'sg-secondary',
              type: 'button',
              text: 'Clear all',
              onclick: () => {
                for (const post of list) setSaved(post, false);
                closeSheet();
                toast('Picks cleared');
              },
            }),
          ])
        : null,
      h('p', { class: 'sg-sheet__status', role: 'status', 'aria-live': 'polite' }),
    ]),
  ]);

  sheet = h('div', { class: 'sg-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Your picks' }, [
    h('div', { class: 'sg-sheet__scrim', onclick: closeSheet }),
    h('div', { class: 'sg-sheet__panel' }, [
      h('button', { class: 'sg-sheet__close', type: 'button', 'aria-label': 'Close', text: '×', onclick: closeSheet }),
      body,
    ]),
  ]);

  document.addEventListener('keydown', onSheetKey);
  document.documentElement.classList.add('sg-locked');
  const opener = document.activeElement;
  document.body.appendChild(sheet);
  sheet.querySelector('.sg-sheet__close')?.focus();
  returnFocusTo = opener instanceof HTMLElement && opener.isConnected ? opener : null;
}

/** Turns the saved products into a link, and optionally into a question. */
async function sharePicks(list, asVote) {
  const status = document.querySelector('.sg-sheet__status');
  if (status) status.textContent = 'Making your link…';

  try {
    const response = await fetch(`${apiRoot.replace(/\/+$/, '')}/api/public/picks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({
        shop: shopDomain,
        productIds: list.map((post) => post.id),
        mode: asVote ? 'vote' : 'list',
      }),
    });
    if (!response.ok) throw new Error(String(response.status));
    const { url, token, ownerKey } = await response.json();
    try {
      // Kept so this browser — and only this browser — can remove the list it
      // made. It is derived from the token by the server, never stored there.
      window.localStorage.setItem(`sillages.picks.${token}`, ownerKey);
    } catch {
      // Storage refused. The link still works; it simply cannot be deleted
      // from this device later.
    }

    void track.push(asVote ? 'picks_vote_created' : 'picks_created', {});
    if (status) status.textContent = '';

    // The link stays on screen either way. It used to live only in the
    // clipboard and in a toast that vanished in three seconds: a shopper who
    // looked away had made a link they could no longer reach.
    const panel = document.querySelector('.sg-sheet__panel') || document.body;
    showLink(url, panel, asVote ? 'Send this to ask your friends' : 'Send this to share your picks');

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: asVote ? 'Which one?' : 'My picks', url });
        return;
      } catch {
        // The shopper closed the device sheet. The link is still on screen.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied. Send it to whoever you like.');
    } catch {
      // Refused. The link is on screen and selected already.
    }
  } catch {
    if (status) status.textContent = 'We could not make that link. Please try again.';
  }
}

// ── Cards ───────────────────────────────────────────────────────

function renderCard(post, gallery, format, open) {
  const media = h('button', {
    class: 'sg-card__media',
    type: 'button',
    'aria-label': `Open ${post.title}`,
    onclick: () => open(post),
  }, [
    post.image
      ? h('img', {
          class: 'sg-card__img',
          src: post.image.url,
          alt: post.image.altText || post.title,
          width: post.image.width || undefined,
          height: post.image.height || undefined,
          loading: 'lazy',
          decoding: 'async',
        })
      : null,
  ]);

  const frame = h('div', { class: 'sg-frame sg-card__frame' }, [
    media,
    saveButton(post),
    h('span', { class: 'sg-card__caption', text: post.title }),
  ]);

  const body = h('div', { class: 'sg-card__body' }, [
    h('a', { class: 'sg-card__title', href: post.url, text: post.title }),
    h('span', { class: 'sg-card__price', text: priceLabel(post, format) }),
    post.available ? null : h('span', { class: 'sg-card__sold', text: 'Sold out' }),
  ]);

  const children = [frame, body];

  // The feed has room to put the actions where a thumb already is.
  if (gallery.layout === 'feed') {
    children.push(
      h('div', { class: 'sg-feed-actions' }, [
        saveButton(post),
        h('button', {
          class: 'sg-share__btn',
          type: 'button',
          text: 'Share',
          onclick: () => open(post),
        }),
        h('button', {
          class: 'sg-feed-actions__buy',
          type: 'button',
          // The card says SOLD OUT one line above this button. Offering to add
          // it to a cart anyway is a promise the shop cannot keep, and the
          // sheet has always known better — the feed did not.
          text: !post.available ? 'Sold out' : gallery.showQuickBuy ? 'Add to cart' : 'View',
          disabled: !post.available,
          onclick: () => open(post),
        }),
      ]),
    );
  }

  return h('div', { class: 'sg-card' }, children);
}

function renderStoryRail(gallery, posts, format) {
  if (!gallery.showStories || gallery.stories.length === 0) return null;

  const byId = new Map(posts.map((post) => [post.id, post]));
  const rail = h('div', { class: 'sg-stories', role: 'list' });

  for (const story of gallery.stories) {
    // The collection the shopper tapped, in the merchant's own order. A
    // collection whose products are not in this gallery — a different
    // collection was chosen, or they are all out of stock — is skipped rather
    // than opened onto the whole catalogue.
    const inStory = (story.productIds || []).map((id) => byId.get(id)).filter(Boolean);
    if (inStory.length === 0) continue;

    // Most shops never set a collection image, and a row of blank grey circles
    // is the least inviting thing a gallery can open with. The first product
    // in the collection is a truthful stand-in: it is what the shopper is
    // about to see anyway, and it costs nothing — the photograph is already in
    // this payload.
    const cover = story.imageUrl || inStory.find((post) => post.image?.url)?.image?.url || null;
    const bubble = h('span', { class: 'sg-story__bubble' }, [
      cover
        ? h('img', { class: 'sg-story__img', src: cover, alt: '', loading: 'lazy', decoding: 'async' })
        : h('span', { class: 'sg-story__placeholder', 'aria-hidden': 'true' }),
    ]);

    // `role="listitem"` used to sit on the button itself, which replaces the
    // button role: a screen reader announced "list item" and the control no
    // longer looked like something you could press. The list item is the
    // wrapper; the button stays a button.
    const button = h('button', { class: 'sg-story', type: 'button' }, [
      bubble,
      h('span', { class: 'sg-story__title', text: story.title }),
    ]);
    button.addEventListener('click', () => {
      button.classList.add('sg-story--seen');
      openViewer(story, inStory, gallery, format);
    });
    rail.appendChild(h('span', { class: 'sg-stories__item', role: 'listitem' }, [button]));
  }
  return rail;
}

// ── Boot ────────────────────────────────────────────────────────

async function boot(root) {
  const shop = root.dataset.shop;
  const apiBase = root.dataset.api;
  if (!shop || !apiBase) {
    root.remove();
    return;
  }
  shopDomain = shop;
  apiRoot = apiBase;

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
    void track.push('gallery_view', { meta: { style: gallery.style, layout: gallery.layout } });
    // Anything still queued when the shopper leaves is sent with keepalive.
    // Not `once`: a page can be hidden and shown again (tab switches, and the
    // back/forward cache), and each of those is a chance to lose a batch.
    // `visibilitychange` fires where `pagehide` does not on mobile Safari.
    window.addEventListener('pagehide', () => void track.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void track.flush();
    });
  }

  root.classList.add(styleClass(gallery.style), layoutClass(gallery.layout), frameClass(gallery.frame));
  root.style.setProperty('--sg-k', String(filterAmount(gallery.filterIntensity)));

  const fragment = document.createDocumentFragment();
  const heading = gallery.heading || root.dataset.heading;
  if (heading) fragment.appendChild(h('h2', { class: 'sg-heading', text: heading }));

  const rail = renderStoryRail(gallery, posts, format);
  if (rail) fragment.appendChild(rail);

  const open = (post) => {
    void track.push('post_open', { productId: post.id });
    const at = posts.indexOf(post);
    openSheet(post, gallery, format, {
      next: at >= 0 && at < posts.length - 1 ? () => open(posts[at + 1]) : null,
    });
  };

  const grid = h('div', { class: 'sg-grid' });
  for (const post of posts) grid.appendChild(renderCard(post, gallery, format, open));
  fragment.appendChild(grid);

  // A way back to what they liked, shown only once they have liked something.
  const savedBar = h('div', { class: 'sg-savedbar', hidden: true }, [
    h('button', { class: 'sg-savedbar__btn', type: 'button', onclick: () => openSavedPanel(gallery, posts, format) }, [
      h('span', { class: 'sg-savedbar__label' }),
    ]),
  ]);
  const savedLabel = savedBar.querySelector('.sg-savedbar__label');
  onSavedChange = () => {
    const count = saved.size;
    savedBar.hidden = count === 0;
    savedLabel.textContent = count === 1 ? '1 pick' : `${count} picks`;
  };
  onSavedChange();
  fragment.appendChild(savedBar);

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
