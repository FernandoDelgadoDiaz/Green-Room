// Where the Qloo key comes from, for local scripts (Node only; never imported by browser code).
// Order: QLOO_API_KEY env var → the private config written by the official `qloo setup --qloo`
// (~/.qloo/config, or $QLOO_HOME/config) → a hidden terminal prompt. The key is kept in memory
// only: this module never writes it, prints it or puts it in a URL.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { QLOO_HACKATHON_BASE_URL } from './client';

export type KeySource = 'env' | 'qloo-setup' | 'prompt';

/** Reads api_key / base_url from the harness config format (KEY=value lines, or JSON). */
export function parseHarnessConfig(content: string): { apiKey?: string; baseUrl?: string } {
  const t = content.trim();
  if (!t) return {};
  let rec: Record<string, unknown> = {};
  if (t.startsWith('{')) {
    try {
      rec = JSON.parse(t);
    } catch {
      return {};
    }
  } else {
    for (const line of t.split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i < 0 || line.trim().startsWith('#')) continue;
      rec[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  return { apiKey: str(rec.api_key), baseUrl: str(rec.base_url) };
}

export function harnessConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.QLOO_HOME?.trim() ? join(env.QLOO_HOME.trim(), 'config') : join(homedir(), '.qloo', 'config');
}

/** The key is only ever sent to Qloo-owned HTTPS hosts. */
export function assertQlooBaseUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  if (u.protocol !== 'https:' || !(u.hostname === 'qloo.com' || u.hostname.endsWith('.qloo.com')) || u.username || u.password) {
    throw new Error(`Refusing to send the Qloo key to ${u.protocol}//${u.hostname}: only https://*.qloo.com is allowed.`);
  }
  return u.origin;
}

/** Replaces every occurrence of the key in a message before it is shown or logged. */
export function redact(text: string, key: string | undefined): string {
  return key && key.length >= 4 ? text.split(key).join('[redacted]') : text;
}

async function hiddenPrompt(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) throw new Error('No TTY for a hidden prompt; set QLOO_API_KEY or run `qloo setup --qloo` first.');
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write('\n');
      if (err) reject(err);
      else resolve(value.trim());
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('Cancelled'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch; // nothing is echoed
      }
    };
    stdin.on('data', onData);
  });
}

export async function loadQlooCredentials(opts: { env?: NodeJS.ProcessEnv; allowPrompt?: boolean } = {}): Promise<{
  apiKey: string;
  baseUrl: string;
  source: KeySource;
}> {
  const env = opts.env ?? process.env;
  let config: { apiKey?: string; baseUrl?: string } = {};
  try {
    config = parseHarnessConfig(readFileSync(harnessConfigPath(env), 'utf8'));
  } catch {
    // No harness config: fine.
  }
  // The harness defaults to production (api.qloo.com); hackathon keys only work on the hackathon host,
  // so a production base_url from the config is not inherited.
  const configBase = config.baseUrl && new URL(config.baseUrl).hostname !== 'api.qloo.com' ? config.baseUrl : undefined;
  const baseUrl = assertQlooBaseUrl(env.QLOO_BASE_URL?.trim() || configBase || QLOO_HACKATHON_BASE_URL);
  if (env.QLOO_API_KEY?.trim()) return { apiKey: env.QLOO_API_KEY.trim(), baseUrl, source: 'env' };
  if (config.apiKey) return { apiKey: config.apiKey, baseUrl, source: 'qloo-setup' };
  if (opts.allowPrompt === false) throw new Error('No Qloo key found (QLOO_API_KEY or `qloo setup --qloo`).');
  const apiKey = await hiddenPrompt('Qloo hackathon API key (input hidden, not stored): ');
  if (!apiKey) throw new Error('Empty key.');
  return { apiKey, baseUrl, source: 'prompt' };
}
