import { getStore } from '@netlify/blobs';

const STORE = 'reservations';
const STATE_KEY = 'state';
const HOLD_MS = 10 * 60 * 1000; // 10 minutes

function now() { return Date.now(); }

async function readState() {
  const store = getStore(STORE, { consistency: 'strong' });
  const state = await store.getJSON(STATE_KEY) || { sold: {}, locks: {} };
  // prune expired locks
  const t = now();
  let mutated = false;
  for (const [rid, lock] of Object.entries(state.locks)) {
    if (!lock || !lock.expireAt || lock.expireAt <= t) {
      delete state.locks[rid];
      mutated = true;
    }
  }
  if (mutated) {
    await store.setJSON(STATE_KEY, state);
  }
  return { store, state };
}

function buildTaken(state) {
  const taken = new Set(Object.keys(state.sold || {}).map(n => +n));
  const t = now();
  for (const lock of Object.values(state.locks || {})) {
    if (lock && lock.expireAt && lock.expireAt > t) {
      for (const b of (lock.blocks || [])) taken.add(+b);
    }
  }
  return taken;
}

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const body = await req.json().catch(() => ({}));
  const blocks = (body.blocks || []).map(n => parseInt(n)).filter(n => Number.isInteger(n) && n >= 0 && n < 10000);
  const email = (body.email || '').toString().slice(0, 200);
  if (!blocks.length) return new Response(JSON.stringify({ ok:false, error:'NO_BLOCKS' }), { status: 400 });

  const { store, state } = await readState();
  const taken = buildTaken(state);
  const conflicts = blocks.filter(b => taken.has(b));
  if (conflicts.length) {
    // Give callers visibility of what's currently pending/sold
    const pending = [];
    const sold = [];
    const t = now();
    for (const b of conflicts) {
      if (state.sold && state.sold[b]) sold.push(b);
      else pending.push(b);
    }
    return new Response(JSON.stringify({ ok:false, error:'CONFLICT', conflicts, pending, sold }), { status: 409, headers: { 'content-type':'application/json' } });
  }

  const rid = crypto.randomUUID();
  const expireAt = now() + HOLD_MS;
  state.locks[rid] = { blocks, email, createdAt: now(), expireAt };
  await store.setJSON(STATE_KEY, state);

  return new Response(JSON.stringify({ ok:true, reservationId: rid, expireAt }), { headers: { 'content-type':'application/json' } });
};
