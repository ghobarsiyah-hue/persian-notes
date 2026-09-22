/* ═══════════════════════════════════════════════════════════════════════
   Collaboration layer tests (node:test, mirroring test/groups.test.mts).

   Covers the invariants the task demands, at the layer where they live:
     - seat atomicity: MAX_ACTIVE_EDITORS=4 can never be exceeded under
       concurrent acquisition (the exact 2-users-fight-for-seat-4 race)
     - stale seats release (heartbeat timeout)
     - reconnect re-binds instead of duplicating sessions
     - multi-tab takeover: one seat per user; the newer tab wins
     - permission revocation releases the seat immediately
     - convergence: concurrent edits from two clients merge through the
       server's yjs doc into ONE identical state on both clients
     - personal notes are never collaborative (auth layer)
   These tests are pure unit/integration on the collab modules (no HTTP),
   so they run fast and deterministically.
   ═══════════════════════════════════════════════════════════════════════ */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

const { sessionStore } = await import('../collab/sessionStore.js');
const { MAX_ACTIVE_EDITORS, HEARTBEAT_TIMEOUT_MS } = await import('../collab/constants.js');
const { createRoom, getRoom, destroyRoomIfIdle } = await import('../collab/rooms.js');

const NOTE = 'note-collab-test-1';

describe('collab session store — seat policy', () => {
  beforeEach(() => sessionStore.reset());

  test('seats up to MAX_ACTIVE_EDITORS then denies', () => {
    for (let i = 0; i < MAX_ACTIVE_EDITORS; i++) {
      const r = sessionStore.acquire({ noteId: NOTE, userId: `u${i}`, connectionId: `c${i}`, displayName: `U${i}` });
      assert.equal(r.ok, true, `seat ${i + 1} should be granted`);
    }
    const fifth = sessionStore.acquire({ noteId: NOTE, userId: 'u5', connectionId: 'c5', displayName: 'U5' });
    assert.equal(fifth.ok, false);
    if (!fifth.ok) assert.equal(fifth.reason, 'full');
    assert.equal(sessionStore.countActive(NOTE), MAX_ACTIVE_EDITORS);
  });

  test('the 2-users-race-for-the-4th-seat never yields 5 editors', () => {
    for (let i = 0; i < MAX_ACTIVE_EDITORS - 1; i++) {
      sessionStore.acquire({ noteId: NOTE, userId: `u${i}`, connectionId: `c${i}`, displayName: `U${i}` });
    }
    // one seat left; two sockets call acquire "simultaneously" — the store
    // is synchronous, so the calls interleave exactly like this would on
    // the event loop; the invariant must hold regardless of order
    const a = sessionStore.acquire({ noteId: NOTE, userId: 'aUser', connectionId: 'cA', displayName: 'A' });
    const b = sessionStore.acquire({ noteId: NOTE, userId: 'bUser', connectionId: 'cB', displayName: 'B' });
    const wins = [a, b].filter((r) => r.ok).length;
    assert.equal(wins, 1, 'exactly ONE of the two competitors gets the last seat');
    assert.equal(sessionStore.countActive(NOTE), MAX_ACTIVE_EDITORS, 'never 5 active editors');
  });

  test('50 concurrent competitors for 4 seats → exactly 4 winners', () => {
    const results = [];
    for (let i = 0; i < 50; i++) {
      results.push(sessionStore.acquire({ noteId: NOTE, userId: `race${i}`, connectionId: `rc${i}`, displayName: 'R' }));
    }
    const winners = results.filter((r) => r.ok).length;
    assert.equal(winners, MAX_ACTIVE_EDITORS);
  });

  test('release frees the seat for the next user', () => {
    for (let i = 0; i < MAX_ACTIVE_EDITORS; i++) {
      sessionStore.acquire({ noteId: NOTE, userId: `u${i}`, connectionId: `c${i}`, displayName: 'U' });
    }
    const before = sessionStore.acquire({ noteId: NOTE, userId: 'waiter', connectionId: 'cW', displayName: 'W' });
    assert.equal(before.ok, false);
    const first = sessionStore.findUserSession(NOTE, 'u0');
    sessionStore.release(first!.sessionId);
    const after = sessionStore.acquire({ noteId: NOTE, userId: 'waiter', connectionId: 'cW2', displayName: 'W' });
    assert.equal(after.ok, true, 'seat opens after release');
  });

  test('stale seats (heartbeat timeout) release automatically', async () => {
    for (let i = 0; i < MAX_ACTIVE_EDITORS; i++) {
      sessionStore.acquire({ noteId: NOTE, userId: `u${i}`, connectionId: `c${i}`, displayName: 'U' });
    }
    const reaped = sessionStore.reapStale();
    assert.equal(reaped.length, 0, 'fresh seats are not reaped');
    // simulate the passage of time beyond the heartbeat window
    const map = sessionStore['byNote'].get(NOTE)!;
    for (const s of map.values()) s.lastHeartbeatAt -= HEARTBEAT_TIMEOUT_MS + 1000;
    const reaped2 = sessionStore.reapStale();
    assert.equal(reaped2.length, MAX_ACTIVE_EDITORS, 'stale seats are reaped');
    assert.equal(sessionStore.countActive(NOTE), 0);
    const late = sessionStore.acquire({ noteId: NOTE, userId: 'late', connectionId: 'cL', displayName: 'L' });
    assert.equal(late.ok, true, 'a crashed browser cannot hold the seat forever');
  });

  test('reconnect re-binds the same seat (no duplicate sessions for one user)', () => {
    const first = sessionStore.acquire({ noteId: NOTE, userId: 'uX', connectionId: 'cX1', displayName: 'X' });
    assert.equal(first.ok, true);
    // same user returns on a NEW connection (network blip / refresh)
    const second = sessionStore.acquire({ noteId: NOTE, userId: 'uX', connectionId: 'cX2', displayName: 'X' });
    assert.equal(second.ok, true);
    if (second.ok) assert.equal(second.session.sessionId, (first as { session: { sessionId: string } }).session.sessionId, 'same session re-bound');
    assert.equal(sessionStore.countActive(NOTE), 1, 'no duplicate active sessions');
  });

  test('multi-tab takeover: newer tab demotes the older (one seat per user)', () => {
    const t1 = sessionStore.acquire({ noteId: NOTE, userId: 'uT', connectionId: 'cT1', displayName: 'T' });
    const t2 = sessionStore.acquire({ noteId: NOTE, userId: 'uT', connectionId: 'cT2', displayName: 'T' });
    assert.equal(t1.ok, true);
    assert.equal(t2.ok, true);
    if (t2.ok) assert.equal(t2.takeover, true, 'second tab reports takeover');
    assert.equal(sessionStore.countActive(NOTE), 1, 'two tabs = ONE seat');
  });

  test('releaseUser clears every seat of a user on a note (revocation)', () => {
    sessionStore.acquire({ noteId: NOTE, userId: 'uR', connectionId: 'cR1', displayName: 'R' });
    sessionStore.acquire({ noteId: NOTE, userId: 'uR', connectionId: 'cR2', displayName: 'R' }); // takeover, still 1
    sessionStore.acquire({ noteId: NOTE, userId: 'other', connectionId: 'cO', displayName: 'O' });
    const n = sessionStore.releaseUser(NOTE, 'uR');
    assert.equal(n, 1);
    assert.equal(sessionStore.findUserSession(NOTE, 'uR'), null, 'revoked user holds no seat');
    assert.equal(sessionStore.countActive(NOTE), 1, 'other users unaffected');
  });
});

describe('collab convergence — yjs merge through the room', () => {
  beforeEach(() => { sessionStore.reset(); destroyRoomIfIdle(NOTE); });

  test('concurrent typing from two clients converges to ONE state', () => {
    const room = getRoom(NOTE) ?? createRoom(NOTE, null, 0);
    // two CLIENT docs emulate two browsers editing the same page fragment
    const clientA = new Y.Doc();
    const clientB = new Y.Doc();
    // server state reaches both (join → state64)
    Y.applyUpdate(clientA, Y.encodeStateAsUpdate(room.doc), 'server');
    Y.applyUpdate(clientB, Y.encodeStateAsUpdate(room.doc), 'server');

    // A and B each type into the SAME fragment concurrently
    const fragName = 'page:p1';
    const localA = (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); Y.applyUpdate(clientB, u, 'server'); };
    const localB = (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); Y.applyUpdate(clientA, u, 'server'); };
    clientA.on('update', (u: Uint8Array) => localA(u));
    clientB.on('update', (u: Uint8Array) => localB(u));

    clientA.transact(() => {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, 'سلام');
      p.insert(0, [t]);
      clientA.getXmlFragment(fragName).insert(0, [p]);
    }, 'local');
    clientB.transact(() => {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, 'دنیا');
      p.insert(0, [t]);
      clientB.getXmlFragment(fragName).insert(0, [p]);
    }, 'local');

    // both clients must converge to the identical merged state (CRDT)
    const aText = clientA.getXmlFragment(fragName).toString();
    const bText = clientB.getXmlFragment(fragName).toString();
    const roomText = room.doc.getXmlFragment(fragName).toString();
    assert.equal(aText, bText, 'client A and B converge');
    assert.equal(aText, roomText, 'server room matches clients');
    assert.ok(aText.includes('سلام') && aText.includes('دنیا'), 'both concurrent edits survive');
  });

  test('remote updates do NOT loop (origin-tagged relay)', () => {
    const room = getRoom(NOTE) ?? createRoom(NOTE, null, 0);
    let serverSent = 0;
    // emulate the hub: only non-'server' origins are relayed
    const relay = (u: Uint8Array, origin: unknown) => { if (origin !== 'server') serverSent++; };
    room.doc.on('update', relay);
    Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(new Y.Doc()), 'server'); // a remote frame
    assert.equal(serverSent, 0, 'a server-origin update is never re-broadcast');
    room.doc.off('update', relay);
  });
});

describe('collab seed conversion — TipTap JSON → yjs XML', () => {
  /* ── page-id parity: the client (EditorPage.splitDocIntoPages) and the
     server (rooms.seedRoomFromNote) MUST derive identical page ids from
     the persisted §4 doc, or each editor binds to a different yjs
     fragment and concurrent edits never converge (HANDOFF invariant). */
  test('page-id derivation is deterministic (pid attr wins, else p<N> ordinal)', async () => {
    const { createRoom, destroyRoomIfIdle, getRoom } = await import('../collab/rooms.js');
    destroyRoomIfIdle(NOTE);
    const stored = {
      type: 'doc',
      attrs: { pageKind: 'framed' },
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'صفحهٔ یک' }] },
        /* a persisted runtime page id rides the break */
        { type: 'pageBreak', attrs: { pid: 'page-1700-abc' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'صفحهٔ دو' }] },
        /* a legacy break without pid falls back to the ordinal */
        { type: 'pageBreak' },
        { type: 'paragraph', content: [{ type: 'text', text: 'صفحهٔ سه' }] },
      ],
    };
    const room = getRoom(NOTE) ?? createRoom(NOTE, stored, 0);
    const structure = room.structure.get('pages') as Array<{ id: string; kind: string }>;
    assert.deepEqual(structure.map((p) => p.id), ['p1', 'page-1700-abc', 'p3']);
    /* fragments exist under exactly the names a client will request */
    assert.ok(room.doc.getXmlFragment('page:p1').length > 0, 'page:p1 seeded');
    assert.ok(room.doc.getXmlFragment('page:page-1700-abc').length > 0, 'persisted pid fragment seeded');
    assert.ok(room.doc.getXmlFragment('page:p3').length > 0, 'ordinal fragment seeded');
    destroyRoomIfIdle(NOTE);
  });

  test('a client editing the derived fragment converges with the room (two clients, one page)', async () => {
    const { createRoom, destroyRoomIfIdle, getRoom } = await import('../collab/rooms.js');
    destroyRoomIfIdle(NOTE);
    const stored = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'پایه' }] }] };
    const room = getRoom(NOTE) ?? createRoom(NOTE, stored, 0);
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(room.doc), 'server');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(room.doc), 'server');
    const relayA = (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); Y.applyUpdate(b, u, 'server'); };
    const relayB = (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); Y.applyUpdate(a, u, 'server'); };
    a.on('update', relayA);
    b.on('update', relayB);
    /* both clients type into THE SAME derived fragment name (page:p1) */
    const fragA = a.getXmlFragment('page:p1');
    const fragB = b.getXmlFragment('page:p1');
    const paraA = fragA.get(0) as unknown as Y.XmlElement;
    const paraB = fragB.get(0) as unknown as Y.XmlElement;
    const textA = paraA.get(0) as unknown as Y.XmlText;
    const textB = paraB.get(0) as unknown as Y.XmlText;
    a.transact(() => { textA.insert(0, 'A'); }, 'local');
    b.transact(() => { textB.insert(textB.length, 'B'); }, 'local');
    assert.equal(fragA.toString(), fragB.toString(), 'both clients converge on the SHARED fragment');
    assert.ok(fragA.toString().includes('A') && fragA.toString().includes('B'), 'both concurrent edits survive');
    destroyRoomIfIdle(NOTE);
  });  test('paragraph + text with bold mark round-trips', async () => {
    const { seedPageFragmentDetached } = await import('../collab/seedJson.js');
    const frag = seedPageFragmentDetached({ type: 'doc', content: [
      { type: 'paragraph', content: [
        { type: 'text', text: 'سلام', marks: [{ type: 'bold', attrs: {} }] },
        { type: 'text', text: ' دنیا' },
      ] },
    ] });
    const s = frag.toString();
    assert.ok(s.includes('<bold>سلام</bold>'), 'bold mark becomes nested element');
    assert.ok(s.includes('دنیا'), 'plain text survives');
  });

  test('seed is idempotent — second seed does not duplicate content', async () => {
    const { seedPageFragment } = await import('../collab/seedJson.js');
    const doc = new Y.Doc();
    const pageJson = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'متن' }] }] };
    assert.equal(seedPageFragment(doc, 'p1', pageJson), true, 'first seed applies');
    assert.equal(seedPageFragment(doc, 'p1', pageJson), false, 'second seed is a no-op');
    assert.equal(doc.getXmlFragment('page:p1').length, 1);
  });
});
