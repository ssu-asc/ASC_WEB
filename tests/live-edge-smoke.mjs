import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function readPublicEnv() {
  const text = readFileSync('.env.local', 'utf8');
  const values = Object.fromEntries(
    text.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
        return [key, value];
      }),
  );
  const url = values.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishable) throw new Error('Missing public Supabase configuration in .env.local');
  if (/secret|service_role/i.test(publishable)) throw new Error('Refusing to use a privileged key in browser smoke test');
  return { url: url.replace(/\/$/, ''), publishable };
}

const { url, publishable } = readPublicEnv();
const functions = ['team-admin', 'operations-settings', 'staff-secrets', 'schedule-series'];
const smokeBodies = {
  'team-admin': { action: 'create_team', name: 'network-smoke-only' },
  'operations-settings': { action: 'create_link', title: 'network-smoke-only', description: '', url: 'https://example.com', service: 'other', category: 'other', audience: 'staff' },
  'staff-secrets': { action: 'list' },
  'schedule-series': { action: 'materialize' },
};
const origins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://0.0.0.0:3000',
  'http://127.0.0.1:3010',
  'http://0.0.0.0:3010',
  'https://ssu-asc.com',
  'https://ssu-asc.github.io',
];

for (const functionName of functions) {
  const endpoint = `${url}/functions/v1/${functionName}`;
  for (const origin of origins) {
    const response = await fetch(endpoint, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,apikey,content-type,x-client-info',
      },
    });
    assert.equal(response.status, 204, `${functionName} preflight status for ${origin}`);
    assert.equal(response.headers.get('access-control-allow-origin'), origin, `${functionName} CORS origin for ${origin}`);
    assert.match(response.headers.get('access-control-allow-headers') ?? '', /authorization/i, `${functionName} authorization header allowed for ${origin}`);
    assert.match(response.headers.get('access-control-allow-headers') ?? '', /apikey/i, `${functionName} apikey header allowed for ${origin}`);
    console.log(`PASS deployed ${functionName} CORS: ${origin}`);
  }

  const rejected = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Origin: 'http://0.0.0.0:3000',
      Authorization: 'Bearer invalid-production-smoke-token',
      apikey: publishable,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(smokeBodies[functionName]),
  });
  assert.equal(rejected.status, 401, `${functionName} gateway should be reachable and reject invalid JWT with HTTP response`);
  console.log(`PASS deployed ${functionName} POST reachability: invalid JWT returns 401 instead of a fetch/CORS failure`);
}
