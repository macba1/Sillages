import { env } from '../../config/env.js';
import { createCatalogClient, type CatalogClient } from '../../lib/shopifyCatalog.js';

const LOG = '[webPixel]';

/**
 * Activates the Web Pixel on a shop.
 *
 * A `web_pixel_extension` with settings does nothing until the app creates it
 * with `webPixelCreate` — deploying the extension is not enough. Without this
 * call the pixel's `settings.apiBase` is empty, it returns before subscribing,
 * and checkout and purchase are never measured on any store.
 *
 * Requires the `write_pixels` scope. The app currently requests `read_pixels`
 * only, so this reports `missing_scope` rather than pretending to have worked —
 * which is what lets the Performance screen tell a merchant the truth about
 * what is and is not being measured.
 */

const CREATE = `
  mutation SillagesWebPixelCreate($webPixel: WebPixelInput!) {
    webPixelCreate(webPixel: $webPixel) {
      webPixel { id }
      userErrors { field message }
    }
  }
`;

const READ = `
  query SillagesWebPixel {
    webPixel { id settings }
  }
`;

export type ActivationResult =
  | { activated: true; id: string; alreadyPresent: boolean }
  | { activated: false; reason: 'missing_scope' | 'rejected' | 'unreachable'; message: string };

export async function activateWebPixel(
  shopDomain: string,
  accessToken: string,
  options: { createClient?: (shop: string, token: string) => CatalogClient } = {},
): Promise<ActivationResult> {
  const client = (options.createClient ?? createCatalogClient)(shopDomain, accessToken);
  const settings = { apiBase: env.SHOPIFY_APP_URL.replace(/\/+$/, '') };

  try {
    const existing = await client.request<{ webPixel: { id: string } | null }>(READ);
    if (existing.webPixel?.id) {
      return { activated: true, id: existing.webPixel.id, alreadyPresent: true };
    }
  } catch {
    // Reading it is optional; creation reports the real outcome.
  }

  try {
    const data = await client.request<{
      webPixelCreate: {
        webPixel: { id: string } | null;
        userErrors: { field: string[] | null; message: string }[];
      };
    }>(CREATE, { webPixel: { settings: JSON.stringify(settings) } });

    const errors = data.webPixelCreate.userErrors;
    if (errors.length > 0) {
      const message = errors.map((e) => e.message).join('; ');
      if (/already/i.test(message)) {
        return { activated: true, id: 'existing', alreadyPresent: true };
      }
      console.warn(`${LOG} ${shopDomain}: Shopify refused activation — ${message}`);
      return { activated: false, reason: 'rejected', message };
    }

    const id = data.webPixelCreate.webPixel?.id;
    if (!id) return { activated: false, reason: 'rejected', message: 'Shopify returned no pixel.' };

    console.log(`${LOG} ${shopDomain}: activated`);
    return { activated: true, id, alreadyPresent: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Shopify answers an access-denied error when the scope is absent.
    if (/access denied|not approved|scope/i.test(message)) {
      console.warn(`${LOG} ${shopDomain}: not activated — the app does not request write_pixels`);
      return { activated: false, reason: 'missing_scope', message };
    }
    return { activated: false, reason: 'unreachable', message };
  }
}
