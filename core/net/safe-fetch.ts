// Server-side fetch for user-supplied or third-party URLs, hardened against SSRF.
//
// Rules: https only (http is upgraded once), default port only, no credentials in the URL, no IP
// literals or local names, every resolved address must be public, redirects are followed manually
// (each hop re-validated, at most 3), responses are size- and time-limited.
// Residual risk (documented in docs/SEARCH_AND_SOURCES.md): the runtime's fetch resolves the host
// again after our check (DNS rebinding window). The function has no private services to reach, and
// responses are only parsed as JSON or RSS, never forwarded raw.

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {
  constructor(
    message: string,
    readonly code: 'scheme' | 'host' | 'private' | 'port' | 'credentials' | 'not_allowed' | 'redirects' | 'too_large' | 'timeout' | 'http' | 'dns',
  ) {
    super(message);
  }
}

const v4 = (ip: string) => ip.split('.').map(Number);

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b, c] = v4(ip);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (kind === 6) {
    const x = ip.toLowerCase().replace(/^\[|\]$/g, '');
    const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (x === '::' || x === '::1') return true;
    const first = parseInt(x.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || x.startsWith('2001:db8');
  }
  return true;
}

export interface SafeFetchOptions {
  /** Restrict to these hosts (exact names). Omit to allow any public host (RSS feeds). */
  allowHosts?: string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  userAgent?: string;
  accept?: string;
  /** Injected in tests. */
  lookup?: (host: string) => Promise<string[]>;
  fetchImpl?: typeof fetch;
}

export const DEFAULT_UA = 'GreenRoom/0.2 (Qloo Agentic Hackathon 2026 demo; https://greenroom1.netlify.app)';

const defaultLookup = async (host: string) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Validates a URL before any network access. Returns the normalized URL. */
export async function assertSafeUrl(raw: string, opts: Pick<SafeFetchOptions, 'allowHosts' | 'lookup'> = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError('Not a valid URL', 'scheme');
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') throw new UnsafeUrlError(`Scheme ${url.protocol} is not allowed`, 'scheme');
  if (url.username || url.password) throw new UnsafeUrlError('Credentials in URLs are not allowed', 'credentials');
  if (url.port && url.port !== '443') throw new UnsafeUrlError('Only the default HTTPS port is allowed', 'port');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isIP(host.replace(/^\[|\]$/g, ''))) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError('Private or reserved address', 'private');
    throw new UnsafeUrlError('IP addresses are not accepted; use a host name', 'host');
  }
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|intranet|home|lan|corp)$/.test(host)) throw new UnsafeUrlError('Local host names are not allowed', 'host');
  if (opts.allowHosts && !opts.allowHosts.includes(host)) throw new UnsafeUrlError(`Host ${host} is not allowed here`, 'not_allowed');
  let addrs: string[];
  try {
    addrs = await (opts.lookup ?? defaultLookup)(host);
  } catch {
    throw new UnsafeUrlError(`Could not resolve ${host}`, 'dns');
  }
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new UnsafeUrlError('Host resolves to a private or reserved address', 'private');
  return url;
}

export interface SafeResponse {
  url: string;
  status: number;
  contentType: string;
  text: string;
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxRedirects = opts.maxRedirects ?? 3;
  const doFetch = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let url = await assertSafeUrl(raw, opts);
    for (let hop = 0; ; hop++) {
      let res: Response;
      try {
        res = await doFetch(url.toString(), { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': opts.userAgent ?? DEFAULT_UA, Accept: opts.accept ?? '*/*' } });
      } catch (err) {
        if (ctrl.signal.aborted) throw new UnsafeUrlError(`Timed out after ${timeoutMs} ms`, 'timeout');
        throw new UnsafeUrlError(`Network error: ${String(err)}`, 'http');
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (hop >= maxRedirects) throw new UnsafeUrlError('Too many redirects', 'redirects');
        url = await assertSafeUrl(new URL(res.headers.get('location')!, url).toString(), opts);
        continue;
      }
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > maxBytes) throw new UnsafeUrlError(`Response larger than ${maxBytes} bytes`, 'too_large');
      // Stream with a hard cap: content-length can be absent or wrong.
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            throw new UnsafeUrlError(`Response larger than ${maxBytes} bytes`, 'too_large');
          }
          chunks.push(value);
        }
      const text = new TextDecoder().decode(Buffer.concat(chunks));
      return { url: url.toString(), status: res.status, contentType: res.headers.get('content-type') ?? '', text };
    }
  } finally {
    clearTimeout(timer);
  }
}

/** JSON helper for allow-listed APIs (Wikidata, Wikipedia, iTunes, oEmbed). */
export async function safeJson(url: string, opts: SafeFetchOptions): Promise<unknown> {
  const r = await safeFetch(url, { maxBytes: 3_000_000, ...opts, accept: 'application/json' });
  if (r.status >= 400) throw new UnsafeUrlError(`HTTP ${r.status}`, 'http');
  return JSON.parse(r.text);
}
