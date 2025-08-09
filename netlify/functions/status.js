import { getStore } from '@netlify/blobs';

const STORE = 'reservations';
const STATE_KEY = 'state';

export default async () => {
  const store = getStore(STORE, { consistency: 'strong' });
  const state = await store.getJSON(STATE_KEY) || { sold: {}, locks: {} };

  const now = Date.now();
  const pending = new Set();
  const expiresById = {};
  for (const [rid, lock] of Object.entries(state.locks || {})) {
    if (!lock || !lock.expireAt || lock.expireAt <= now) continue;
    expiresById[rid] = lock.expireAt;
    for (const b of (lock.blocks || [])) pending.add(+b);
  }

  const sold = Object.keys(state.sold || {}).map(n => +n);

  return new Response(JSON.stringify({
    ok: true,
    now,
    pending: Array.from(pending),
    sold,
    locks: Object.fromEntries(Object.entries(state.locks || {}).map(([id, l]) => [id, { blocks: l.blocks, expireAt: l.expireAt }]))
  }), { headers: { 'content-type':'application/json' } });
};
