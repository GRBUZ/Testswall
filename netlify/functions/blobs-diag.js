import { getStore } from '@netlify/blobs';
import { json } from './_common.js';

export default async () => {
  try {
    const store = getStore('reservations', { consistency: 'strong' });
    const key = 'diag';
    const payload = { ts: Date.now() };
    await store.setJSON(key, payload);
    const roundtrip = await store.getJSON(key);
    return json({ ok: true, roundtrip });
  } catch (e) {
    return json({ ok: false, error: 'BLOBS_ERROR', message: e?.message || String(e) }, 500);
  }
};
