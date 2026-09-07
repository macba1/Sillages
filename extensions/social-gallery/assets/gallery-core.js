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
