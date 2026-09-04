import OpenAI from 'openai';
import { env } from '../config/env.js';

// The key is optional when PRODUCT_MODE=social_gallery (the new product does not
// use OpenAI). The placeholder keeps this module import-safe; any real call made
// without a key configured will fail at request time, which is the intended
// behaviour — the new product must never reach this client.
export const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY ?? 'sk-placeholder-not-active',
});
