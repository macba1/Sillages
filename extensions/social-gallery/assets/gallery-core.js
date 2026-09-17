/**
 * Pure logic for the storefront gallery.
 *
 * Kept free of DOM access so it can be unit-tested directly: variant matching
 * and the cart payload are the two places where a bug silently sells the wrong
 * thing, so they are tested rather than eyeballed.
 */

/** Photo treatments the merchant can choose from. */
export const STYLES = ['original', 'warm', 'film', 'soft', 'vintage', 'flash'];

/** How the products are arranged. */
export const LAYOUTS = ['grid', 'polaroid', 'feed', 'stories'];

/** What is drawn around each photograph. */
export const FRAMES = ['none', 'clean', 'polaroid', 'film', 'card'];

export function styleClass(style) {
  return STYLES.includes(style) ? `sg--${style}` : 'sg--original';
}

export function layoutClass(layout) {
  return LAYOUTS.includes(layout) ? `sg-layout--${layout}` : 'sg-layout--grid';
}

export function frameClass(frame) {
  return FRAMES.includes(frame) ? `sg-frame--${frame}` : 'sg-frame--none';
}

/**
 * Filter strength as the 0–1 multiplier the stylesheet expects.
 *
 * Anything unusable becomes 1 — the filter as designed — rather than 0, so a
 * malformed value shows the look the merchant chose instead of silently
 * turning their whole gallery back to plain photographs.
 */
export function filterAmount(intensity) {
  const n = Number(intensity);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n / 100));
}

/** Where the storefront reads its gallery from. */
export function buildApiUrl(apiBase, shopDomain, collectionHandle) {
  const base = String(apiBase || '').replace(/\/+$/, '');
  const url = `${base}/api/public/gallery/${encodeURIComponent(shopDomain)}`;
  // Present only on a collection template. It selects which products are
  // returned; the design always comes from the merchant's saved settings.
  return collectionHandle ? `${url}?collection=${encodeURIComponent(collectionHandle)}` : url;
}

/**
 * Distinct option names in the order Shopify presents them, with their values.
 * Used to build one selector per option.
 */
export function optionGroups(post) {
  const groups = [];
  for (const variant of post.variants || []) {
    for (const option of variant.options || []) {
      let group = groups.find((g) => g.name === option.name);
      if (!group) {
        group = { name: option.name, values: [] };
        groups.push(group);
      }
      if (!group.values.includes(option.value)) group.values.push(option.value);
    }
  }
  return groups;
}

/**
 * The variant matching every chosen option.
 *
 * Returns null rather than guessing when the combination does not exist, so the
 * buy button can be disabled instead of adding something the shopper did not
 * pick. A product with no options at all resolves to its single variant.
 */
export function selectVariant(post, chosen) {
  const variants = post.variants || [];
  if (variants.length === 0) return null;

  const names = optionGroups(post).map((g) => g.name);
  if (names.length === 0) return variants[0];

  const wanted = chosen || {};
  const allChosen = names.every((name) => typeof wanted[name] === 'string' && wanted[name].length > 0);
  if (!allChosen) return null;

  return (
    variants.find((variant) =>
      names.every((name) => {
        const option = (variant.options || []).find((o) => o.name === name);
        return option && option.value === wanted[name];
      }),
    ) || null
  );
}

/**
 * Which values of one option can still be bought, given the others.
 *
 * Used to strike through a size that is sold out in the colour on screen,
 * rather than letting a shopper pick it and be told no at the last step.
 */
export function availableValues(post, groupName, chosen) {
  const variants = post.variants || [];
  const others = Object.entries(chosen || {}).filter(([name]) => name !== groupName);
  const usable = new Set();

  for (const variant of variants) {
    if (!variant.available) continue;
    const options = variant.options || [];
    const matchesOthers = others.every(([name, value]) => {
      const option = options.find((o) => o.name === name);
      return !option || option.value === value;
    });
    if (!matchesOthers) continue;
    const mine = options.find((o) => o.name === groupName);
    if (mine) usable.add(mine.value);
  }
  return usable;
}

/** The default selection when a post is opened: the first variant in stock. */
export function defaultSelection(post) {
  const variants = post.variants || [];
  const first = variants.find((v) => v.available) || variants[0];
  if (!first) return {};
  const chosen = {};
  for (const option of first.options || []) chosen[option.name] = option.value;
  return chosen;
}

/** Body for Shopify's own /cart/add.js on the shop's origin. */
export function cartPayload(variant, quantity = 1) {
  if (!variant || typeof variant.id !== 'number') return null;
  const qty = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
  return { items: [{ id: variant.id, quantity: qty }] };
}

/** Price label for a post, before a variant is chosen. */
export function priceLabel(post, formatter) {
  const format = formatter || ((value) => value);
  if (!post.priceMin) return '';
  if (!post.priceMax || post.priceMin === post.priceMax) return format(post.priceMin);
  return `${format(post.priceMin)} – ${format(post.priceMax)}`;
}

/**
 * Shopify's money format is theme-defined; without it we fall back to a plain
 * amount rather than inventing a currency symbol.
 */
export function makeMoneyFormatter(currencyCode, locale) {
  if (!currencyCode) return (value) => String(value);
  try {
    const nf = new Intl.NumberFormat(locale || 'en', { style: 'currency', currency: currencyCode });
    return (value) => nf.format(Number(value));
  } catch {
    return (value) => String(value);
  }
}

/** Posts worth rendering: something to show and something to buy. */
export function renderablePosts(gallery) {
  if (!gallery || gallery.active !== true) return [];
  return (gallery.posts || []).filter((post) => post && post.image && post.image.url && post.handle);
}

// ── Session, saves, sharing and measurement ─────────────────────────────────
//
// All pure or storage-injected, so the behaviour a shopper gets is the
// behaviour under test.

const SESSION_KEY = 'sillages_sid';
const SAVED_PREFIX = 'sillages_saved:';

/** A random, meaningless id. Never derived from anything about the person. */
export function newSessionId(random = () => Math.random()) {
  let out = '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  for (let i = 0; i < 22; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

/**
 * The session for this browser. Stored locally so a shopper is never asked to
 * sign in, and readable by nobody but this device.
 */
export function readSession(storage, random) {
  try {
    const existing = storage.getItem(SESSION_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const created = newSessionId(random);
    storage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    // Private browsing, or storage disabled: measure the page view only.
    return newSessionId(random);
  }
}

export function readSaved(storage, shop) {
  try {
    const raw = storage.getItem(SAVED_PREFIX + shop);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => Number.isSafeInteger(id)) : [];
  } catch {
    return [];
  }
}

/** Toggles a save locally. Returns the new list and whether it is now saved. */
export function toggleSaved(storage, shop, productId) {
  const current = readSaved(storage, shop);
  const has = current.includes(productId);
  const next = has ? current.filter((id) => id !== productId) : [...current, productId];
  try {
    storage.setItem(SAVED_PREFIX + shop, JSON.stringify(next.slice(-500)));
  } catch {
    // A save that cannot be persisted still applies for this page view.
  }
  return { saved: !has, list: next };
}

/**
 * Where a shopper can send a product.
 *
 * `native` is only offered when the device actually supports it, so the button
 * is never a dead end.
 */
export function shareLinks(post, origin, hasNativeShare = false) {
  const url = `${String(origin || '').replace(/\/+$/, '')}${post.url}`;
  const text = `${post.title} — ${url}`;
  return {
    url,
    link: url,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    native: hasNativeShare ? { title: post.title, url } : null,
  };
}

/**
 * Where the shareable card for one product is drawn.
 *
 * The card is a 1080×1920 image Sillages renders on the server from the
 * product photograph the shop already publishes. Everything the URL carries is
 * already public; nothing about the shopper is in it.
 */
export function shareCardUrl(apiBase, shopDomain, productId) {
  const base = String(apiBase || '').replace(/\/+$/, '');
  return `${base}/api/public/share-card/${encodeURIComponent(shopDomain)}/${Number(productId)}.jpg`;
}

/** Saved products, in the order the shopper saved them, as full posts. */
export function savedPosts(posts, savedIds) {
  const ids = savedIds instanceof Set ? savedIds : new Set(savedIds || []);
  const byId = new Map((posts || []).map((post) => [post.id, post]));
  const out = [];
  for (const id of ids) {
    const post = byId.get(id);
    if (post) out.push(post);
  }
  return out;
}

/**
 * Batches events and sends them at most every `flushMs`, or as soon as
 * `maxBatch` pile up.
 *
 * The timer matters more than it looks. Without it the queue only emptied
 * at `maxBatch` or on an explicit flush, so a shopper who browsed, saved and
 * shared — but did not add to cart — had every one of those events sitting in
 * memory, and "Saved" and "Shared" stayed at zero on a gallery people were
 * actually using.
 *
 * Measurement must never slow a storefront down, so nothing is sent
 * synchronously and a failed send is dropped rather than retried forever.
 * `schedule` is injectable so tests do not have to wait on real time.
 */
export function createEventQueue({
  send,
  now = () => Date.now(),
  maxBatch = 20,
  flushMs = 5000,
  schedule = (fn, ms) => (typeof setTimeout === 'function' ? setTimeout(fn, ms) : null),
  unschedule = (handle) => { if (handle !== null && typeof clearTimeout === 'function') clearTimeout(handle); },
  random,
}) {
  let queue = [];
  let timer = null;

  function push(type, fields = {}) {
    queue.push({
      type,
      id: newSessionId(random).slice(0, 16) + String(now()).slice(-6),
      occurredAt: new Date(now()).toISOString(),
      ...fields,
    });
    if (queue.length >= maxBatch) return flush();
    if (timer === null && flushMs > 0) {
      timer = schedule(() => { timer = null; void flush(); }, flushMs);
    }
    return Promise.resolve();
  }

  function flush() {
    unschedule(timer);
    timer = null;
    if (queue.length === 0) return Promise.resolve();
    const batch = queue;
    queue = [];
    return Promise.resolve(send(batch)).catch(() => {
      // Dropped on purpose: a lost measurement is better than a stuck queue.
    });
  }

  return { push, flush, get size() { return queue.length; } };
}
