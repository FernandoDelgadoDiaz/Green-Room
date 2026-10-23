// Server-side variables read by the public LIVE functions (discover and its background runner).
export const PUBLIC_ENV_KEYS = [
  'QLOO_PUBLIC_ENABLED',
  'QLOO_API_KEY',
  'QLOO_BASE_URL',
  'PUBLIC_DAILY_QLOO_CALLS',
  'PUBLIC_CALLS_PER_ANALYSIS',
  'PUBLIC_MAX_CONCURRENT',
  'PUBLIC_FRESH_PER_IP_PER_DAY',
  'PUBLIC_OPEN_FEEDS_PER_DAY',
  'PUBLIC_CACHE_HOURS',
  'PUBLIC_PARTIAL_CACHE_HOURS',
  'PUBLIC_JOB_MAX_SECONDS',
  'PUBLIC_EXTERNAL_VERIFY_MAX',
  'PUBLIC_IP_SALT',
  'EXTERNAL_VERIFY',
  'PROFILE_LOOKUP',
] as const;

export const publicEnv = () => Object.fromEntries(PUBLIC_ENV_KEYS.map((k) => [k, process.env[k]]));
