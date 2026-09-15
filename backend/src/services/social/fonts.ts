import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Makes a font available to the share-card renderer.
 *
 * The card is drawn as SVG and rasterised by sharp, which hands the text to
 * librsvg, which asks fontconfig for a font. A plain Node container has no
 * fonts at all, so fontconfig returned nothing and every character came out as
 * an empty box — the product name, the price, the shop name, the whole card.
 * It looked right locally, where macOS has fonts, and shipped unreadable.
 *
 * So the font travels with the app rather than being assumed: two DejaVu files
 * (free to redistribute; see assets/fonts/LICENSE) and a fontconfig file
 * written at startup that points at them. Nothing is installed into the image
 * and no system font is relied upon, which means the card renders the same on
 * a developer's machine and in production.
 */

const FAMILY = 'DejaVu Sans';

let configured: string | null = null;

/** The vendored font directory, wherever this is running from. */
function fontDirectory(): string | null {
  const candidates = [
    // dist/services/social -> backend/assets/fonts, and the same from src.
    resolve(__dirname, '..', '..', '..', 'assets', 'fonts'),
    resolve(__dirname, '..', '..', '..', '..', 'assets', 'fonts'),
    // Started from the backend directory, which is how it runs in production.
    resolve(process.cwd(), 'assets', 'fonts'),
    resolve(process.cwd(), 'backend', 'assets', 'fonts'),
  ];
  return candidates.find((dir) => existsSync(join(dir, 'DejaVuSans.ttf'))) ?? null;
}

/**
 * Points fontconfig at the vendored fonts. Idempotent, and safe to call on
 * every render: fontconfig reads the file the first time it is asked for a
 * font, so this has to happen before the first card is drawn.
 *
 * Returns the family name to use, or null when the fonts are missing — the
 * caller then knows the text would be unreadable and can decline to draw it
 * rather than producing a card full of empty boxes.
 */
export function ensureShareCardFont(): string | null {
  if (configured !== null) return configured || null;

  const dir = fontDirectory();
  if (!dir) {
    console.warn('[share-card] no bundled font found — text would not render');
    configured = '';
    return null;
  }

  // A private fontconfig file, written where the process can always write.
  const confDir = mkdtempSync(join(tmpdir(), 'sillages-fonts-'));
  const confFile = join(confDir, 'fonts.conf');
  writeFileSync(
    confFile,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${dir}</dir>
  <cachedir>${confDir}</cachedir>
  <match target="pattern">
    <test qual="any" name="family"><string>sans-serif</string></test>
    <edit name="family" mode="assign" binding="same"><string>${FAMILY}</string></edit>
  </match>
</fontconfig>
`,
    'utf8',
  );

  process.env.FONTCONFIG_FILE = confFile;
  process.env.FONTCONFIG_PATH = confDir;
  configured = FAMILY;
  return FAMILY;
}
