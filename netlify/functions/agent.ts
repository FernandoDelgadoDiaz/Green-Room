import type { Handler } from '@netlify/functions';
import { handleApi, type ApiRequest } from '../../core/api';

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  let req: ApiRequest;
  try {
    req = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  try {
    const { status, body } = await handleApi(req, { QLOO_API_KEY: process.env.QLOO_API_KEY, QLOO_BASE_URL: process.env.QLOO_BASE_URL, PROFILE_LOOKUP: process.env.PROFILE_LOOKUP });
    return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
