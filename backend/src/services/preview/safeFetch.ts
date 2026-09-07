import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Guarded fetch for URLs a stranger supplies.
 *
 * The before/after generator takes a shop URL from an untrusted form, so this
 * is the product's SSRF boundary. Without it, anyone could point the generator
 * at our own infrastructure — cloud metadata endpoints, internal services, a
 * database admin port — and read the response back through the preview.
 *
 * The rules, all enforced on every hop of a redirect chain:
 *   - https only (http is allowed solely for localhost in tests);
 *   - the resolved address must be publicly routable;
 *   - a bounded number of redirects, each re-checked;
 *   - a response size cap and a timeout, so one URL cannot exhaust us.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const MAX_REDIRECTS = 3;
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const TIMEOUT_MS = 8_000;

/** Ranges that must never be reachable from a user-supplied URL. */
function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10) return true;                        // private
    if (a === 127) return true;                       // loopback
    if (a === 0) return true;                         // "this" network
    if (a === 169 && b === 254) return true;          // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true;          // private
    if (a === 100 && b >= 64 && b <= 127) return true;// carrier NAT
    if (a >= 224) return true;                        // multicast and reserved
    return false;
  }

  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    if (value === '::1' || value === '::') return true;
    if (value.startsWith('fe80')) return true;                 // link-local
    if (value.startsWith('fc') || value.startsWith('fd')) return true; // unique local
    // IPv4-mapped addresses must be judged by their IPv4 form.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  return true; // unparseable: refuse
}

export interface SafeFetchOptions {
  /** Injected in tests so no DNS lookup or network call happens. */
  lookup?: (hostname: string) => Promise<string[]>;
  transport?: (
    url: string,
    init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> },
  ) => Promise<Response>;
  allowLoopback?: boolean;
  maxBytes?: number;
}

/**
 * Resolves a hostname and refuses it unless every answer is publicly routable.
 *
 * Returns the addresses so the caller can connect to one of them directly.
 * Checking and then letting the OS resolve again at connect time is the classic
 * DNS-rebinding hole: a hostname can answer with a public address for our check
 * and a private one microseconds later, for the connection.
 */
async function resolvePublicAddresses(hostname: string, options: SafeFetchOptions): Promise<string[]> {
  if (options.allowLoopback && (hostname === '127.0.0.1' || hostname === 'localhost')) {
    return ['127.0.0.1'];
  }

  // A literal address needs no lookup, and must be judged directly.
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new UnsafeUrlError('That address is not reachable.');
    return [hostname];
  }

  const lookup = options.lookup ?? (async (host: string) => {
    const records = await dns.lookup(host, { all: true });
    return records.map((record) => record.address);
  });

  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new UnsafeUrlError('We could not find that store.');
  }

  if (addresses.length === 0) throw new UnsafeUrlError('We could not find that store.');
  // Every resolved address must be public: one private answer is enough to
  // make the whole hostname unsafe.
  for (const address of addresses) {
    if (isPrivateAddress(address)) throw new UnsafeUrlError('That address is not reachable.');
  }
  return addresses;
}

export function assertAllowedScheme(url: URL, options: SafeFetchOptions): void {
  if (url.protocol === 'https:') return;
  if (options.allowLoopback && url.protocol === 'http:') return;
  throw new UnsafeUrlError('Only https addresses are supported.');
}

/**
 * Performs one request with Node's own HTTP client.
 *
 * `fetch` cannot be used here. It is undici, which silently **ignores** the
 * `agent` option — a pinned agent passed to `fetch` is never called, so the
 * rebinding defence would look present and do nothing. Node's client accepts a
 * `lookup`, which is the only way to guarantee the socket connects to the
 * address we validated.
 */
function nodeRequest(
  url: URL,
  init: { headers: Record<string, string>; lookup: ReturnType<typeof pinnedLookup>; maxBytes: number; timeoutMs: number },
): Promise<{ status: number; headers: Headers; body: string; location: string | null }> {
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: init.headers,
        // The whole point: the socket resolves through us, not through DNS.
        lookup: init.lookup as never,
        // Keeps SNI and certificate verification on the real hostname.
        servername: url.hostname,
        timeout: init.timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (typeof value === 'string') headers.set(key, value);
          else if (Array.isArray(value)) headers.set(key, value.join(', '));
        }

        // Redirects are re-checked by the caller, never followed here.
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, headers, body: '', location: response.headers.location ?? null });
          return;
        }

        const declared = Number(response.headers['content-length'] ?? '0');
        if (declared > init.maxBytes) {
          response.destroy();
          reject(new UnsafeUrlError('That store returned too much data.'));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;

        response.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > init.maxBytes) {
            // A chunked response with no content-length would otherwise stream
            // unbounded data into memory on an unauthenticated endpoint.
            response.destroy();
            request.destroy();
            reject(new UnsafeUrlError('That store returned too much data.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8'), location: null });
        });
        response.on('error', () => reject(new UnsafeUrlError('We could not reach that store.')));
      },
    );

    // The deadline covers the whole exchange, not only the handshake.
    request.setTimeout(init.timeoutMs, () => {
      request.destroy();
      reject(new UnsafeUrlError('That store took too long to answer.'));
    });
    request.on('error', (err) => {
      reject(err instanceof UnsafeUrlError ? err : new UnsafeUrlError('We could not reach that store.'));
    });
    request.end();
  });
}

export interface SafeResponse {
  url: string;
  status: number;
  headers: Headers;
  body: string;
}

/** Fetches a public URL, refusing anything that could reach a private network. */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  let current: URL;

  try {
    current = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError('That does not look like a web address.');
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    assertAllowedScheme(current, options);
    // Credentials in a URL are a classic way to confuse a fetcher.
    if (current.username || current.password) throw new UnsafeUrlError('That address is not supported.');
    const addresses = await resolvePublicAddresses(current.hostname, options);

    // Tests inject a transport; production takes the pinned Node path.
    if (options.transport) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        let response: Response;
        try {
          response = await options.transport(current.toString(), {
            redirect: 'manual',
            signal: controller.signal,
            headers: { Accept: 'application/json, text/html', 'User-Agent': 'Sillages-Preview/1.0' },
          });
        } catch {
          throw new UnsafeUrlError('We could not reach that store.');
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) throw new UnsafeUrlError('We could not reach that store.');
          current = new URL(location, current);
          continue;
        }

        const declared = Number(response.headers.get('content-length') ?? '0');
        if (declared > maxBytes) throw new UnsafeUrlError('That store returned too much data.');

        const body = await readCapped(response, maxBytes);
        return { url: current.toString(), status: response.status, headers: response.headers, body };
      } finally {
        clearTimeout(timer);
      }
    }

    const result = await nodeRequest(current, {
      headers: { Accept: 'application/json, text/html', 'User-Agent': 'Sillages-Preview/1.0' },
      lookup: pinnedLookup(addresses),
      maxBytes,
      timeoutMs: TIMEOUT_MS,
    });

    if (result.status >= 300 && result.status < 400) {
      if (!result.location) throw new UnsafeUrlError('We could not reach that store.');
      current = new URL(result.location, current);
      continue;
    }

    return { url: current.toString(), status: result.status, headers: result.headers, body: result.body };
  }

  throw new UnsafeUrlError('That address redirects too many times.');
}

/**
 * Reads a response body, refusing to buffer more than `maxBytes`.
 *
 * Falls back to `text()` only when the response exposes no stream, which is the
 * case for the synthetic responses used in tests.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const stream = response.body;
  if (!stream || typeof stream.getReader !== 'function') {
    const body = await response.text();
    if (body.length > maxBytes) throw new UnsafeUrlError('That store returned too much data.');
    return body;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength ?? 0;
      if (total > maxBytes) {
        throw new UnsafeUrlError('That store returned too much data.');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  chunks.push(decoder.decode());
  return chunks.join('');
}

/**
 * The DNS resolver a pinned connection uses: it ignores the hostname entirely
 * and hands back the address we already validated, refusing anything else.
 *
 * This is the whole rebinding defence in one function, which is why it is
 * exported and tested directly rather than only through a socket.
 */
export function pinnedLookup(allowed: string[]) {
  const permitted = new Set(allowed);

  return (
    _hostname: string,
    _options: unknown,
    // Node types the address as required here; the error path passes an error
    // and nothing else, which the runtime accepts.
    callback: (err: Error | null, address: string, family: number) => void,
  ): void => {
    const target = allowed[0];
    // Belt and braces: the address must still be in the validated set, and
    // must still be public. A private address can never leave this function
    // even if the set were somehow polluted.
    if (!target || !permitted.has(target) || isPrivateAddress(target)) {
      (callback as (err: Error | null) => void)(new UnsafeUrlError('That address is not reachable.'));
      return;
    }
    callback(null, target, net.isIPv6(target) ? 6 : 4);
  };
}

/** Exported for the tests that pin the private-range rules. */
export const __testing = { isPrivateAddress, resolvePublicAddresses, pinnedLookup, nodeRequest };
