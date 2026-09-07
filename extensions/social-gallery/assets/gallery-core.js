/**
 * Pure logic for the storefront gallery.
 *
 * Kept free of DOM access so it can be unit-tested directly: variant matching
 * and the cart payload are the two places where a bug silently sells the wrong
 * thing, so they are tested rather than eyeballed.
 */

/** The three looks the merchant can choose from. */
export const STYLES = ['original', 'warm', 'film'];

export function styleClass(style) {
  return STYLES.includes(style) ? `sg--${style}` : 'sg--original';
}

/** Where the storefront reads its gallery from. */
export function buildApiUrl(apiBase, shopDomain) {
  const base = String(apiBase || '').replace(/\/+$/, '');
  return `${base}/api/public/gallery/${encodeURIComponent(shopDomain)}`;
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
 * Batches events and sends them at most every `flushMs`, or as soon as
 * `maxBatch` pile up.
 *
 * Measurement must never slow a storefront down, so nothing is sent
 * synchronously and a failed send is dropped rather than retried forever.
 */
export function createEventQueue({ send, now = () => Date.now(), maxBatch = 20, random }) {
  let queue = [];

  function push(type, fields = {}) {
    queue.push({
      type,
      id: newSessionId(random).slice(0, 16) + String(now()).slice(-6),
      occurredAt: new Date(now()).toISOString(),
      ...fields,
    });
    if (queue.length >= maxBatch) return flush();
    return Promise.resolve();
  }

  function flush() {
    if (queue.length === 0) return Promise.resolve();
    const batch = queue;
    queue = [];
    return Promise.resolve(send(batch)).catch(() => {
      // Dropped on purpose: a lost measurement is better than a stuck queue.
    });
  }

  return { push, flush, get size() { return queue.length; } };
}
