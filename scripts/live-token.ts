// Generates a private access token for /api/live and the SHA-256 that goes into Netlify.
//   npm run live:token
// Run it on your own computer. The token is printed once to your terminal: keep it in a password
// manager. Only the hash goes into Netlify (LIVE_ACCESS_TOKEN_SHA256); the token itself is never stored.
import { randomBytes } from 'node:crypto';
import { sha256Hex } from '../core/access';

const token = randomBytes(32).toString('base64url');
console.log('Private token (type it in the app with ?private=1; do not share it in chats):');
console.log(`  ${token}`);
console.log('\nNetlify variable LIVE_ACCESS_TOKEN_SHA256 =');
console.log(`  ${sha256Hex(token)}`);
