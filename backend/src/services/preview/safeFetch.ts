import dns from 'node:dns/promises';
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
  transport?: (url: string, init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
  allowLoopback?: boolean;
  maxBytes?: number;
}

async function assertPublicHost(hostname: string, options: SafeFetchOptions): Promise<void> {
  if (options.allowLoopback && (hostname === '127.0.0.1' || hostname === 'localhost')) return;

  // A literal address needs no lookup, and must be judged directly.
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new UnsafeUrlError('That address is not reachable.');
    return;
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
}

export function assertAllowedScheme(url: URL, options: SafeFetchOptions): void {
  if (url.protocol === 'https:') return;
  if (options.allowLoopback && url.protocol === 'http:') return;
  throw new UnsafeUrlError('Only https addresses are supported.');
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
    await assertPublicHost(current.hostname, options);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      const transport = options.transport ?? ((url, init) => fetch(url, init));
      response = await transport(current.toString(), {
        redirect: 'manual', // every hop is re-checked, never followed blindly
        signal: controller.signal,
        headers: { Accept: 'application/json, text/html', 'User-Agent': 'Sillages-Preview/1.0' },
      });
    } catch {
      throw new UnsafeUrlError('We could not reach that store.');
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new UnsafeUrlError('We could not reach that store.');
      current = new URL(location, current);
      continue;
    }

    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > maxBytes) throw new UnsafeUrlError('That store returned too much data.');

    const body = await response.text();
    if (body.length > maxBytes) throw new UnsafeUrlError('That store returned too much data.');

    return { url: current.toString(), status: response.status, headers: response.headers, body };
  }

  throw new UnsafeUrlError('That address redirects too many times.');
}

/** Exported for the tests that pin the private-range rules. */
export const __testing = { isPrivateAddress };
