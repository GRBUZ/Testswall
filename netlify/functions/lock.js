import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';
import { json } from './_common.js';

const STORE = 'reservations';
const STATE_KEY = 'state';
const HOLD_MS = 10 * 60 * 1000; // 10 minutes

const now = () => Date.now();

async function readState() {
  const store = getStore(STORE, { consistency: 'strong' });
  const state = await store.getJSON(STATE_KEY) || { sold: {}, locks: {} };
  // prune expired
  const t = now();
  let mutated = false;
  for (const [rid, lock] of Object.entries(state.locks)) {
    if (!lock?.expireAt || lock.expireAt <= t) {
      delete state.locks[rid];
      mutated = true;
    }
  }
  if (mutated) await store.setJSON(STATE_KEY, state);
  return { store, state };
}

function buildTaken(state) {
  const taken = new Set(Object.keys(state.sold || {}).map(n => +n));
  const t = now();
  for (const lock of Object.values(state.locks || {})) {
    if (lock?.expireAt > t) for (const b of (lock.blocks || [])) taken.add(+b);
  }
  return taken;
}

export default async (req) => {
  try {
    if (req.method === 'OPTIONS') return json({}, 204);
    if (req.method !== 'POST') return json({ ok:false, error:'METHOD_NOT_ALLOWED' }, 405);

    const body = await req.json().catch(() => ({}));
    const blocks = (body.blocks || []).map(n => parseInt(n)).filter(n => Number.isInteger(n) && n >= 0 && n < 10000);
    const email = (body.email || '').toString().slice(0, 200);

    if (!blocks.length) return json({ ok:false, error:'NO_BLOCKS' }, 400);

    const { store, state } = await readState();
    const taken = buildTaken(state);
    const conflicts = blocks.filter(b => taken.has(b));
    if (conflicts.length) {
      const pending = [];
      const sold = [];
      for (const b of conflicts) (state.sold && state.sold[b]) ? sold.push(b) : pending.push(b);
      return json({ ok:false, error:'CONFLICT', conflicts, pending, sold }, 409);
    }

    const rid = randomUUID();
    const expireAt = now() + HOLD_MS;
    state.locks[rid] = { blocks, email, createdAt: now(), expireAt };
    await store.setJSON(STATE_KEY, state);

    return json({ ok:true, reservationId: rid, expireAt });
  } catch (e) {
    console.error('lock error', e);
    return json({ ok:false, error:'SERVER_ERROR' }, 500);
  }
};
