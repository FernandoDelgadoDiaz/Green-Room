// Background runner for public LIVE analyses (the "-background" suffix gives up to 15 minutes; the
// client already got 202). It only runs a job that exists in Blobs and is still queued, claims it
// atomically, and never throws, so Netlify's automatic retries and repeated POSTs are harmless.
import { runPublicJob } from '../../core/public-live/handler';
import { blobsStore } from '../../core/public-live/blobs-store';
import { publicEnv } from '../../core/public-live/env';

export default async (req: Request): Promise<void> => {
  if (req.method !== 'POST') return;
  let jobId: unknown;
  try {
    jobId = ((await req.json()) as { jobId?: unknown }).jobId;
  } catch {
    return;
  }
  if (typeof jobId !== 'string') return;
  await runPublicJob(jobId, publicEnv(), { store: blobsStore() });
};

export const config = {
  path: '/api/discover-run',
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
