import { getStore } from '@netlify/blobs';

const STORE = 'reservations';
const STATE_KEY = 'state';

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await req.json().catch(() => ({}));
  const rid = (body.reservationId || '').toString();

  const store = getStore(STORE, { consistency: 'strong' });
  const state = await store.getJSON(STATE_KEY) || { sold: {}, locks: {} };

  if (rid && state.locks && state.locks[rid]) {
    delete state.locks[rid];
    await store.setJSON(STATE_KEY, state);
    return new Response(JSON.stringify({ ok:true }));
  }
  return new Response(JSON.stringify({ ok:false, error:'NOT_FOUND' }), { status: 404 });
};
