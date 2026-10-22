import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('secrets stay server-side', () => {
  it('browser code never reads QLOO_API_KEY or imports the live client', () => {
    for (const f of files('src')) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/QLOO_API_KEY|import\.meta\.env\.VITE_QLOO|qloo\/client/);
    }
  });
  it('.env files are gitignored', () => {
    expect(readFileSync('.gitignore', 'utf8')).toMatch(/^\.env$/m);
  });
});
