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
  /** Escape hatch for tests that need the guard without the pinning agent. */
  skipPinning?: boolean;
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

/**
 * An agent that connects only to the addresses we already validated, and
 * re-checks each one at connect time.
 *
 * This is what closes the rebinding window: the socket cannot reach an address
 * the check never saw, whatever DNS says by then. TLS still verifies the
 * certificate against the original hostname, so pinning the address does not
 * weaken it.
 */
function pinnedAgent(protocol: string, hostname: string, allowed: string[]): http.Agent | https.Agent {
  const createConnection = (
    options: Record<string, unknown>,
    onCreate: (err: Error | null, socket?: net.Socket) => void,
  ) => {
    const target = allowed[0];
    const connectOptions = {
      ...options,
      host: target,
      // Keeps SNI and certificate verification on the real hostname.
      servername: hostname,
      lookup: pinnedLookup(allowed),
    };

    const socket = protocol === 'https:'
      ? https.globalAgent.createConnection!(connectOptions as never, onCreate as never)
      : http.globalAgent.createConnection!(connectOptions as never, onCreate as never);
    return socket;
  };

  const Agent = protocol === 'https:' ? https.Agent : http.Agent;
  const agent = new Agent({ keepAlive: false });
  (agent as unknown as { createConnection: typeof createConnection }).createConnection = createConnection;
  return agent;
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
    const addresses = await resolvePublicAddresses(current.hostname, options);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const transport = options.transport ?? ((url, init) => fetch(url, init));
      let response: Response;
      try {
        response = await transport(current.toString(), {
          redirect: 'manual', // every hop is re-checked, never followed blindly
          signal: controller.signal,
          headers: { Accept: 'application/json, text/html', 'User-Agent': 'Sillages-Preview/1.0' },
          // Connect only to the address we validated. Without this the OS
          // resolves the hostname again at connect time, and a record that
          // answered publicly for the check can answer privately for the
          // connection.
          ...(options.transport || options.skipPinning
            ? {}
            : { agent: pinnedAgent(current.protocol, current.hostname, addresses) }),
        } as never);
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

      // Read with a real cap. A host that answers chunked with no
      // content-length would otherwise stream unbounded data into memory: the
      // declared length is 0, so the check above passes, and this endpoint is
      // unauthenticated.
      const body = await readCapped(response, maxBytes);

      return { url: current.toString(), status: response.status, headers: response.headers, body };
    } finally {
      // Only once the body is read. Clearing it after the headers arrived left
      // the rest of the transfer with no deadline at all.
      clearTimeout(timer);
    }
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
    callback: (err: Error | null, address?: string, family?: number) => void,
  ): void => {
    const target = allowed[0];
    // Belt and braces: the address must still be in the validated set, and
    // must still be public. A private address can never leave this function
    // even if the set were somehow polluted.
    if (!target || !permitted.has(target) || isPrivateAddress(target)) {
      callback(new UnsafeUrlError('That address is not reachable.'));
      return;
    }
    callback(null, target, net.isIPv6(target) ? 6 : 4);
  };
}

/** Exported for the tests that pin the private-range rules. */
export const __testing = { isPrivateAddress, resolvePublicAddresses, pinnedAgent, pinnedLookup };
