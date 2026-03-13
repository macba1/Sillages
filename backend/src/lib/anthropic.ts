import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';

export const anthropic = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;
