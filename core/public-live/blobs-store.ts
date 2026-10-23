// Netlify Blobs implementation of CasStore (production only; imported by the Netlify Functions).
// Strong consistency so every instance reads the latest write; ETag conditions make updates atomic.
import { getStore } from '@netlify/blobs';
import type { CasStore } from './guard';

export function blobsStore(): CasStore | null {
  let store: ReturnType<typeof getStore>;
  try {
    store = getStore({ name: 'public-live', consistency: 'strong' });
  } catch {
    return null; // Blobs not available in this environment → callers fail closed
  }
  return {
    async get(key) {
      const r = await store.getWithMetadata(key, { type: 'json' });
      return r && r.etag ? { data: r.data, etag: r.etag } : null;
    },
    async set(key, data, cond) {
      return (await store.setJSON(key, data, cond)).modified;
    },
    async put(key, data) {
      await store.setJSON(key, data);
    },
  };
}
