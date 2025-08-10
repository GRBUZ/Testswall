import { json } from './_common.js';
export default async () => json({ ok: true, node: process.version, env: 'netlify-functions' });
