import { Resend } from 'resend';
import { env } from '../config/env.js';

// The key is optional when PRODUCT_MODE=social_gallery (the new product sends no
// email). The placeholder keeps this module import-safe; a real send without a
// configured key fails at request time, which is the intended behaviour.
export const resend = new Resend(env.RESEND_API_KEY ?? 're_placeholder_not_active');
