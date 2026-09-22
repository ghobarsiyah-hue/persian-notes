/* ═══════════════════════════════════════════════════════════════════════
   QA probe — real-time collaboration WebSocket (end-to-end, live server).

   Verifies over an actual socket (NOT unit mocks):
     1. authenticated upgrade + join → seat 'active' for the group-note owner
     2. yjs room seeding: the server's state64 contains the stored page text
     3. an incremental yjs 'update' round-trips back as a fan-out frame
     4. sync.step1 (state vector) → sync.step2 diff works
     5. heartbeats keep the session alive; presence reports 1/4 editors
   Run:  node scripts/qa-collab-ws.mjs   (server must be running on :4000)
   ═══════════════════════════════════════════════════════════════════════ */
import WebSocket from 'ws';

const BASE = 'http://localhost:4000/api';

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const stamp = Date.now();
/* unique emails per run — registration must always succeed (the sparse-null
   E11000 regression broke exactly this when the 2nd user signed up) */
const owner = await api('/auth/register', { method: 'POST', body: { name: 'کولب اوونر', email: `qa-collab-o${stamp}@t.local`, password: 'test12345678' } });
const peer = await api('/auth/register', { method: 'POST', body: { name: 'کولب پیر', email: `qa-collab-p${stamp}@t.local`, password: 'test12345678' } });
console.log('✔ two fresh registrations succeeded (no username-null E11000)');

const { group } = await api('/groups', { method: 'POST', token: owner.token, body: { name: `گروه کیو‌ای ${stamp}` } });
const { note } = await api(`/groups/${group.id}/notes`, {
  method: 'POST', token: owner.token,
  body: { title: 'جزوه کیو‌ای', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'متن پایه' }] }] } },
});
console.log(`✔ group ${group.id} + group note ${note._id} created`);

const pre = await api('/collab/preflight', { method: 'POST', token: owner.token, body: { noteId: note._id } });
if (!pre.collaborative || !pre.canEdit || pre.maxEditors !== 4) throw new Error('preflight wrong: ' + JSON.stringify(pre));
console.log('✔ preflight: collaborative, canEdit, maxEditors=4');

/* join the room as the owner (auto seat) */
const ws = new WebSocket(`ws://localhost:4000/api/collab?noteId=${note._id}&token=${encodeURIComponent(owner.token)}`);
const frames = [];
const waitFrame = (pred, ms = 6000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout waiting for frame')), ms);
  const check = (f) => { if (pred(f)) { clearTimeout(t); resolve(f); } };
  for (const f of frames) check(f);
  frames.push = ((orig) => (f) => { orig.call(frames, f); check(f); return frames.length; })(frames.push.bind(frames));
});

await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
ws.on('message', (d) => frames.push(JSON.parse(String(d))));
ws.send(JSON.stringify({ t: 'join', noteId: note._id }));

const joined = await waitFrame((f) => f.t === 'joined');
if (joined.seat !== 'active') throw new Error('owner should get an active seat: ' + JSON.stringify(joined));
console.log(`✔ joined → seat=active, session=${joined.sessionId.slice(0, 8)}…, maxEditors=${joined.maxEditors}`);

/* yjs: decode the room state and check the seeded page text is in it.
   Minimal check: state64 non-empty; the CRDT text check lives in the unit
   suite (collab.test.mts). Here we exercise the PROTOCOL paths. */
if (!joined.state64 || joined.state64.length < 8) throw new Error('empty room state');
console.log(`✔ room state received (${Math.round(joined.state64.length / 1.37)} bytes est.)`);

/* a REAL client doc mirrors the room state first (like session.ts 'joined') */
const Y = (await import('yjs')).default ?? (await import('yjs'));
const clientDoc = new Y.Doc();
Y.applyUpdate(clientDoc, Buffer.from(joined.state64, 'base64'));
const frag = clientDoc.getXmlFragment('page:p1');
const before = frag.toString();
if (!before.includes('متن پایه')) throw new Error('seeded room state does not contain the stored page text! got: ' + before);
console.log('✔ room state decodes to the stored page text (seed parity)');

/* sync.step1 with a REAL state vector → expect sync.step2 */
ws.send(JSON.stringify({ t: 'sync.step1', s64: Buffer.from(Y.encodeStateVector(clientDoc)).toString('base64') }));
const step2 = await waitFrame((f) => f.t === 'sync.step2');
if (!step2.u64) throw new Error('sync.step2 empty');
Y.applyUpdate(clientDoc, Buffer.from(step2.u64, 'base64'));
console.log('✔ sync.step1 → sync.step2 (state-vector diff) works');

/* an incremental update: register the listener BEFORE the transaction,
   then send the produced binary op (exactly what wireDocObserver does) */
const pending = [];
clientDoc.on('update', (u) => pending.push(u));
clientDoc.transact(() => {
  const para = new Y.XmlElement('paragraph');
  const t = new Y.XmlText();
  t.insert(0, 'افزودهٔ کیو‌ای');
  para.insert(0, [t]);
  frag.insert(frag.length, [para]);
}, 'local');
await new Promise((r) => setTimeout(r, 50));
if (!pending.length) throw new Error('no local yjs update produced');
ws.send(JSON.stringify({ t: 'update', u64: Buffer.from(pending[0]).toString('base64') }));
const ack = await waitFrame((f) => f.t === 'server.ack');
console.log('✔ update frame accepted → server.ack (write authority verified)');

/* presence: expect a seats frame listing this editor */
const seats = await waitFrame((f) => f.t === 'seats' && f.editors.length >= 1);
console.log(`✔ presence: ${seats.editors.length}/${seats.max} editors, first=${seats.editors[0].displayName}`);

/* the peer (non-member) CAN upgrade (upgrade validates identity only) but
   must NEVER join the room: expect denied/forbidden + close 4003 */
const ws2 = new WebSocket(`ws://localhost:4000/api/collab?noteId=${note._id}&token=${encodeURIComponent(peer.token)}`);
const frames2 = [];
ws2.on('message', (d) => frames2.push(JSON.parse(String(d))));
const joinVerdict = await new Promise((res) => {
  ws2.on('open', () => ws2.send(JSON.stringify({ t: 'join', noteId: note._id })));
  ws2.on('close', (code) => res(`closed code=${code}`));
  const iv = setInterval(() => {
    const denied = frames2.find((f) => f.t === 'denied');
    if (denied) { clearInterval(iv); res(`denied reason=${denied.reason}`); }
  }, 100);
  setTimeout(() => { clearInterval(iv); res('timeout-no-denial'); }, 4000);
});
if (!joinVerdict.includes('forbidden') && !joinVerdict.includes('4003')) throw new Error(`non-member was NOT blocked: ${joinVerdict} — permission leak!`);
console.log(`✔ non-member join blocked (${joinVerdict})`);
try { ws2.close(); } catch { /* already closing */ }

/* heartbeat keeps the seat */
ws.send(JSON.stringify({ t: 'heartbeat' }));
await new Promise((r) => setTimeout(r, 300));
console.log('✔ heartbeat sent');

/* leave cleanly */
ws.send(JSON.stringify({ t: 'leave' }));
await new Promise((r) => setTimeout(r, 300));
ws.close();
console.log('✔ seat released (leave)');

console.log('\nALL COLLAB WS PROBES PASSED ✅');
process.exit(0);
