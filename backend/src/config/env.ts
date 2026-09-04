import { parseEnv } from './envSchema.js';

export { PRODUCT_MODES, parseEnv } from './envSchema.js';
export type { ProductMode } from './envSchema.js';

const parsed = parseEnv(process.env);

if (!parsed.success) {
  console.error('[env] Missing or invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
