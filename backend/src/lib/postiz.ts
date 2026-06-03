/**
 * Postiz client — self-hosted social publishing (github.com/gitroomhq/postiz-app).
 *
 * Public API: `{POSTIZ_API_URL}/public/v1`, auth via `Authorization: <api-key>`.
 *   POST /upload  (multipart `file`)        -> { id, path }
 *   POST /posts   (json)                     -> schedules/publishes a post
 *   GET  /integrations                       -> connected channels
 *
 * Everything is gated on configuration: if POSTIZ_API_URL / POSTIZ_API_KEY are
 * absent (placeholder until Tony deploys Postiz + connects Instagram), calls
 * throw a clear "not configured" error and the content workflow stays dry.
 */

import axios from 'axios';
import { env } from '../config/env.js';

const LOG = '[postiz]';

export function isPostizConfigured(): boolean {
  return Boolean(env.POSTIZ_API_URL && env.POSTIZ_API_KEY);
}

function base(): string {
  if (!isPostizConfigured()) {
    throw new Error('Postiz not configured — set POSTIZ_API_URL and POSTIZ_API_KEY');
  }
  return `${env.POSTIZ_API_URL!.replace(/\/$/, '')}/public/v1`;
}

function headers(): Record<string, string> {
  return { Authorization: env.POSTIZ_API_KEY! };
}

export interface UploadedMedia { id: string; path: string }

/** Upload a media buffer (image or video). Returns the Postiz media id + URL. */
export async function uploadMedia(buffer: Buffer, filename: string, mime: string): Promise<UploadedMedia> {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename);

  const { data } = await axios.post(`${base()}/upload`, form, {
    headers: headers(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  if (!data?.id || !data?.path) throw new Error(`Postiz upload returned no id/path: ${JSON.stringify(data)}`);
  return { id: data.id, path: data.path };
}

export interface PostizIntegration { id: string; name?: string; identifier?: string; providerIdentifier?: string }

/** List connected channels (Instagram, etc.). */
export async function listIntegrations(): Promise<PostizIntegration[]> {
  const { data } = await axios.get(`${base()}/integrations`, { headers: headers() });
  return Array.isArray(data) ? data : (data?.integrations ?? []);
}

/** Resolve the Instagram integration id (env override wins, else first IG channel). */
export async function resolveInstagramIntegrationId(): Promise<string> {
  if (env.POSTIZ_INTEGRATION_ID) return env.POSTIZ_INTEGRATION_ID;
  const integrations = await listIntegrations();
  const ig = integrations.find(i =>
    /instagram/i.test(i.providerIdentifier ?? '') ||
    /instagram/i.test(i.identifier ?? '') ||
    /instagram/i.test(i.name ?? ''),
  );
  if (!ig) throw new Error('No Instagram integration found in Postiz — connect the account in the Postiz UI first');
  return ig.id;
}

export interface CreatePostInput {
  integrationId: string;
  content: string;
  media: UploadedMedia;
  /** When to publish. Postiz auto-sends at this time; pick a future slot for review. */
  when: Date;
  /** 'schedule' (default) queues for `when`; 'now' publishes immediately; 'draft' stores for manual review (no auto-send). */
  mode?: 'schedule' | 'now' | 'draft';
  /** Platform __type — 'instagram' for IG feed posts. */
  platform?: string;
}

export interface CreatePostResult { postId: string | null; raw: unknown }

/** Schedule or publish a post with one media attachment. */
export async function createPost(input: CreatePostInput): Promise<CreatePostResult> {
  const { integrationId, content, media, when, mode = 'schedule', platform = 'instagram' } = input;

  const body = {
    type: mode,
    date: when.toISOString(),
    shortLink: false,
    tags: [],
    posts: [
      {
        integration: { id: integrationId },
        value: [{ content, image: [{ id: media.id, path: media.path }] }],
        settings: { __type: platform },
      },
    ],
  };

  const { data } = await axios.post(`${base()}/posts`, body, {
    headers: { ...headers(), 'Content-Type': 'application/json' },
  });

  // Postiz returns varying shapes across versions; extract a best-effort id.
  const postId: string | null =
    data?.[0]?.postId ?? data?.[0]?.id ?? data?.postId ?? data?.id ?? null;
  console.log(`${LOG} createPost mode=${mode} -> ${postId ?? 'no-id'}`);
  return { postId, raw: data };
}
