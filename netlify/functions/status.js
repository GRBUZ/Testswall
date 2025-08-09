import { getStore } from '@netlify/blobs';
import { json } from './_common.js';

const STORE = 'reservations';
const STATE_KEY = 'state';

export default async () => {
  try {
    const store = getStore(STORE, { consistency: 'strong' });
    const state = await store.getJSON(STATE_KEY) || { sold: {}, locks: {} };

    const now = Date.now();
    const pending = new Set();
    for (const [rid, lock] of Object.entries(state.locks || {})) {
      if (lock?.expireAt > now) for (const b of (lock.blocks || [])) pending.add(+b);
    }
    const sold = Object.keys(state.sold || {}).map(n => +n);

    return json({
      ok: true,
      now,
      pending: Array.from(pending),
      sold
    });
  } catch (e) {
    console.error('status error', e);
    return json({ ok:false, error:'SERVER_ERROR' }, 500);
  }
};
