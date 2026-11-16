// bonk on Netlify: every /api/* request runs here, and the state is kept as a
// single JSON entry in Netlify Blobs instead of data.json. The rules are in bonk.js.

import { getStore } from '@netlify/blobs';
import { handleApi } from '../../bonk.js';

export default async (req, context) => {
  // Deploy previews, branch deploys and `netlify dev` get their own store and
  // the "Skip to tomorrow" button, so testing never touches your real data.
  const testing = ['deploy-preview', 'branch-deploy', 'dev'].includes(context.deploy?.context);
  const store = getStore({ name: testing ? 'bonk-testing' : 'bonk', consistency: 'strong' });

  const storage = {
    async load() {
      const entry = await store.getWithMetadata('state', { type: 'json' });
      return entry ? { data: entry.data, version: { etag: entry.etag } } : { data: null, version: null };
    },
    // Only saves if nobody else has saved since we loaded. Otherwise bonk.js starts over.
    // (`netlify dev` doesn't report etags, so there it just saves.)
    async save(data, version) {
      const options = !version ? { onlyIfNew: true } : version.etag ? { onlyIfMatch: version.etag } : {};
      const { modified } = await store.setJSON('state', data, options);
      return modified;
    },
  };

  const url = new URL(req.url);
  const out = await handleApi({
    method: req.method,
    path: url.pathname,
    cookie: req.headers.get('cookie'),
    https: url.protocol === 'https:',
    body: req.method === 'POST' ? await req.text() : '',
  }, { storage, dev: testing });

  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (out.cookie) headers['Set-Cookie'] = out.cookie;
  return new Response(JSON.stringify(out.body), { status: out.status, headers });
};

export const config = { path: '/api/*' };
