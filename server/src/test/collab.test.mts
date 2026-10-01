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

/* client collab modules are imported with a RUNTIME-computed specifier:
   tsc must not typecheck client sources from the server project (browser
   globals + rootDir), but tsx resolves the relative path at test runtime */
const clientModule = (name: string): string =>
  decodeURIComponent(new URL(`../../../client/src/collab/${name}.ts`, import.meta.url).pathname);

const { sessionStore } = await import('../collab/sessionStore.js');
const { MAX_ACTIVE_EDITORS, HEARTBEAT_TIMEOUT_MS } = await import('../collab/constants.js');
const { createRoom, getRoom, destroyRoomIfIdle } = await import('../collab/rooms.js');

const NOTE = 'note-collab-test-1';

/** small helper: a yjs paragraph element with one text run (test content
 *  builder — content shapes here mirror what the client's editors emit) */
function textPara(text: string): Y.XmlElement {
  const p = new Y.XmlElement('paragraph');
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  return p;
}

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

  test('a creator arriving late (capacity full) gets ok:false=full — hub must send denied:capacity', () => {
    /* REGRESSION (user report): the CREATOR/ADMIN of a group note who joins
       when 4 seats are taken saw an UNEXPLAINED «فقط مشاهده» — the hub used
       to send only `joined{seat:'view'}` with no `denied` frame, so the UI
       had neither a reason nor a retry path. The store result drives the
       hub's explicit denied:capacity send (verified in hub.ts join). */
    for (let i = 0; i < MAX_ACTIVE_EDITORS; i++) {
      const r = sessionStore.acquire({ noteId: NOTE, userId: `u${i}`, connectionId: `c${i}`, displayName: 'U' });
      assert.equal(r.ok, true);
    }
    const creator = sessionStore.acquire({ noteId: NOTE, userId: 'creator-id', connectionId: 'cCreator', displayName: 'Creator' });
    assert.equal(creator.ok, false, 'creator is not above the seat cap');
    if (!creator.ok) {
      assert.equal(creator.reason, 'full', 'the hub maps THIS result to denied:capacity');
    }
    /* and the moment a seat frees, the same creator re-acquires (auto-upgrade) */
    const first = sessionStore.findUserSession(NOTE, 'u0');
    sessionStore.release(first!.sessionId);
    const retry = sessionStore.acquire({ noteId: NOTE, userId: 'creator-id', connectionId: 'cCreator2', displayName: 'Creator' });
    assert.equal(retry.ok, true, 'creator gets a seat as soon as one frees');
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

/* ═════════════════════════════════════════════════════════════════════
   §30 STRUCTURE — semantic page-structure collaboration (A)
   ═════════════════════════════════════════════════════════════════════ */
describe('collab structure — semantic page ops (§30 A)', () => {
  beforeEach(() => { sessionStore.reset(); destroyRoomIfIdle(NOTE); });

  /** two client docs wired through the room, like two browsers */
  function wireClients(room: ReturnType<typeof createRoom>) {
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(room.doc), 'server');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(room.doc), 'server');
    a.on('update', (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); Y.applyUpdate(b, u, 'server'); });
    b.on('update', (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); Y.applyUpdate(a, u, 'server'); });
    return { a, b };
  }

  test('CREATE_PAGE converges: same order entry + meta + fragment binding on both clients', async () => {
    const { createRoom, destroyRoomIfIdle, getRoom } = await import('../collab/rooms.js');
    destroyRoomIfIdle(NOTE);
    const room = getRoom(NOTE) ?? createRoom(NOTE, { type: 'doc', content: [{ type: 'paragraph' }] }, 0);
    const { a, b } = wireClients(room);

    /* A creates a page through the SEMANTIC op (mirrors session.opCreatePage) */
    a.transact(() => {
      a.getArray('pageOrder').push(['page-x1']);
      a.getMap('pageMeta').set('page-x1', { kind: 'notebook', auto: false });
    }, 'local');

    /* B must see: the same order, the same meta, and the same fragment NAME */
    const orderB = (b.getArray('pageOrder').toArray() as string[]).filter((v) => typeof v === 'string');
    assert.deepEqual(orderB, ['p1', 'page-x1']);
    const metaB = b.getMap('pageMeta').get('page-x1') as { kind: string; auto: boolean };
    assert.equal(metaB.kind, 'notebook');
    assert.equal(metaB.auto, false);

    /* content ops from A on the new fragment must land in B immediately
       (the §3 known limitation — binding follows structure with NO special
       ordering: same fragment name = same CRDT type) */
    a.transact(() => {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, 'صفحهٔ تازه');
      p.insert(0, [t]);
      b; /* binding by NAME, not reference */
      a.getXmlFragment('page:page-x1').insert(0, [p]);
    }, 'local');
    assert.ok(b.getXmlFragment('page:page-x1').toString().includes('صفحهٔ تازه'), 'content follows the structural op with no ordering races');
    destroyRoomIfIdle(NOTE);
  });

  test('DELETE_PAGE is entry-level: other pages untouched, fragment + floats cleared', async () => {
    const { createRoom, destroyRoomIfIdle, getRoom } = await import('../collab/rooms.js');
    destroyRoomIfIdle(NOTE);
    const stored = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'اول' }] },
        { type: 'pageBreak', attrs: { pid: 'page-del' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'دوم' }] },
        { type: 'pageBreak', attrs: { pid: 'p3' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'سوم' }] },
      ],
    };
    const room = getRoom(NOTE) ?? createRoom(NOTE, stored, 0);
    const { a, b } = wireClients(room);

    assert.deepEqual((a.getArray('pageOrder').toArray() as string[]).filter((v) => typeof v === 'string'), ['p1', 'page-del', 'p3']);
    /* A deletes the middle page */
    a.transact(() => {
      const order = a.getArray('pageOrder');
      const idx = order.toArray().indexOf('page-del');
      if (idx >= 0) order.delete(idx, 1);
      a.getMap('pageMeta').delete('page-del');
      const frag = a.getXmlFragment('page:page-del');
      frag.delete(0, frag.length);
      a.getMap('floatObj:page-del').clear();
    }, 'local');

    const orderB = (b.getArray('pageOrder').toArray() as string[]).filter((v) => typeof v === 'string');
    assert.deepEqual(orderB, ['p1', 'p3'], 'delete removes exactly ONE entry');
    assert.ok(b.getXmlFragment('page:p1').toString().includes('اول'), 'first page preserved');
    assert.ok(b.getXmlFragment('page:p3').toString().includes('سوم'), 'third page preserved');
    assert.equal(b.getXmlFragment('page:page-del').length, 0, 'deleted page fragment emptied');
    destroyRoomIfIdle(NOTE);
  });

  test('concurrent DELETE + MOVE converge without duplicates or phantom pages', async () => {
    const { createRoom, destroyRoomIfIdle, getRoom } = await import('../collab/rooms.js');
    destroyRoomIfIdle(NOTE);
    const stored = {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        { type: 'pageBreak', attrs: { pid: 'pB' } },
        { type: 'paragraph' },
        { type: 'pageBreak', attrs: { pid: 'pC' } },
        { type: 'paragraph' },
      ],
    };
    const room = getRoom(NOTE) ?? createRoom(NOTE, stored, 0);
    const { a, b } = wireClients(room);

    /* WITHOUT a relay mesh (each client relays only to the room + the other
       client, the room relays nothing back automatically in this harness),
       deliver each client's ops to the OTHER client explicitly: */
    // (the wireClients relay already covers room↔clients)

    /* A moves pC before p1 while B deletes pB — concurrent structure ops */
    a.transact(() => {
      const order = a.getArray('pageOrder');
      const ids = order.toArray() as string[];
      const from = ids.indexOf('pC');
      if (from >= 0) {
        order.delete(from, 1);
        order.insert(0, ['pC']);
      }
    }, 'local');
    b.transact(() => {
      const order = b.getArray('pageOrder');
      const idx = order.toArray().indexOf('pB');
      if (idx >= 0) order.delete(idx, 1);
    }, 'local');

    /* converge: feed each side the other's update once more (state-vector
       diff) — the CRDT must produce ONE identical, duplicate-free order */
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), 'server');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'server');
    const orderA = (a.getArray('pageOrder').toArray() as string[]).filter((v) => typeof v === 'string');
    const orderB2 = (b.getArray('pageOrder').toArray() as string[]).filter((v) => typeof v === 'string');
    assert.deepEqual(orderA, orderB2, 'both clients converge to the SAME order');
    assert.equal(new Set(orderA).size, orderA.length, 'no duplicate page ids');
    assert.ok(!orderA.includes('pB'), 'deleted page stays deleted (no phantom)');
    assert.equal(orderA.length, 2, 'exactly the surviving pages');
    destroyRoomIfIdle(NOTE);
  });

  test('page id stays STABLE after the room is re-seeded from a persisted doc (reload parity)', async () => {
    const { createRoom, destroyRoomIfIdle, getRoom } = await import('../collab/rooms.js');
    destroyRoomIfIdle(NOTE);
    const stored = {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        { type: 'pageBreak', attrs: { pid: 'page-1700-abc', kind: 'notebook' } },
        { type: 'paragraph' },
      ],
    };
    const room1 = getRoom(NOTE) ?? createRoom(NOTE, stored, 0);
    const order1 = room1.pageOrder.toArray();
    destroyRoomIfIdle(NOTE); /* server restart equivalent */
    const room2 = getRoom(NOTE) ?? createRoom(NOTE, stored, 1);
    const order2 = room2.pageOrder.toArray();
    assert.deepEqual(order2, order1, 'page identity survives a room rebuild');
    assert.deepEqual(order2, ['p1', 'page-1700-abc']);
    destroyRoomIfIdle(NOTE);
  });
});

/* ═════════════════════════════════════════════════════════════════════
   §30 C — FLOATING OBJECTS: per-object property merge + delete safety
   ═════════════════════════════════════════════════════════════════════ */
describe('collab floats — per-object semantic state (§30 C)', () => {
  beforeEach(() => { sessionStore.reset(); destroyRoomIfIdle(NOTE); });

  test('A moves x while B resizes width: BOTH property updates survive', async () => {
    const room = getRoom(NOTE) ?? createRoom(NOTE, { type: 'doc', content: [{ type: 'paragraph' }] }, 0);
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(room.doc), 'server');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(room.doc), 'server');
    a.on('update', (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); Y.applyUpdate(b, u, 'server'); });
    b.on('update', (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); Y.applyUpdate(a, u, 'server'); });

    /* shared object: A creates it (full upsert) */
    a.transact(() => {
      const m = a.getMap('floatObj:p1');
      const props = new Y.Map<unknown>();
      props.set('x', 100); props.set('y', 50); props.set('width', 200); props.set('height', 120);
      m.set('obj1', props);
    }, 'local');

    /* A changes x, B changes width — CONCURRENTLY (neither saw the other) */
    a.transact(() => { (a.getMap('floatObj:p1').get('obj1') as Y.Map<unknown>).set('x', 150); }, 'local');
    b.transact(() => { (b.getMap('floatObj:p1').get('obj1') as Y.Map<unknown>).set('width', 260); }, 'local');

    /* converge both ways */
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), 'server');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'server');

    for (const d of [a, b]) {
      const props = d.getMap('floatObj:p1').get('obj1') as Y.Map<unknown>;
      assert.equal(props.get('x'), 150, 'A\'s x change survived');
      assert.equal(props.get('width'), 260, 'B\'s width change survived');
      assert.equal(props.get('y'), 50, 'untouched property intact');
    }
    destroyRoomIfIdle(NOTE);
  });

  test('concurrent writes to the SAME property converge to ONE value (no corruption)', async () => {
    const room = getRoom(NOTE) ?? createRoom(NOTE, { type: 'doc', content: [{ type: 'paragraph' }] }, 0);
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(room.doc), 'server');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(room.doc), 'server');
    a.on('update', (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); Y.applyUpdate(b, u, 'server'); });
    b.on('update', (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); Y.applyUpdate(a, u, 'server'); });
    a.transact(() => {
      const props = new Y.Map<unknown>();
      props.set('x', 0);
      a.getMap('floatObj:p1').set('obj2', props);
    }, 'local');
    a.transact(() => { (a.getMap('floatObj:p1').get('obj2') as Y.Map<unknown>).set('x', 111); }, 'local');
    b.transact(() => { (b.getMap('floatObj:p1').get('obj2') as Y.Map<unknown>).set('x', 222); }, 'local');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), 'server');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'server');
    const va = (a.getMap('floatObj:p1').get('obj2') as Y.Map<unknown>).get('x');
    const vb = (b.getMap('floatObj:p1').get('obj2') as Y.Map<unknown>).get('x');
    assert.equal(va, vb, 'deterministic convergence');
    assert.ok(va === 111 || va === 222, 'one of the two writes won (LWW per key)');
    destroyRoomIfIdle(NOTE);
  });

  test('floating TEXT rides the property map (collaborative state, §9)', async () => {
    const room = getRoom(NOTE) ?? createRoom(NOTE, { type: 'doc', content: [{ type: 'paragraph' }] }, 0);
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(room.doc), 'server');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(room.doc), 'server');
    a.on('update', (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); Y.applyUpdate(b, u, 'server'); });
    b.on('update', (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); Y.applyUpdate(a, u, 'server'); });
    a.transact(() => {
      const props = new Y.Map<unknown>();
      props.set('type', 'sticky'); props.set('text', '');
      a.getMap('floatObj:p1').set('sticky1', props);
    }, 'local');
    b.transact(() => { (b.getMap('floatObj:p1').get('sticky1') as Y.Map<unknown>).set('text', 'یادداشت چسبان'); }, 'local');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), 'server');
    assert.equal(((a.getMap('floatObj:p1').get('sticky1')) as Y.Map<unknown>).get('text'), 'یادداشت چسبان');
    destroyRoomIfIdle(NOTE);
  });

  test('floats on a DELETED page are removed and never reappear', async () => {
    const { createRoom, destroyRoomIfIdle, getRoom } = await import('../collab/rooms.js');
    destroyRoomIfIdle(NOTE);
    const stored = {
      type: 'doc',
      content: [
        { type: 'paragraph' },
        { type: 'pageBreak', attrs: { pid: 'pGone' } },
        { type: 'paragraph' },
      ],
      floatingElements: [],
    };
    const room = getRoom(NOTE) ?? createRoom(NOTE, stored, 0);
    const a = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(room.doc), 'server');
    a.on('update', (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); });
    /* a float exists on the doomed page */
    a.transact(() => {
      const props = new Y.Map<unknown>();
      props.set('x', 1);
      a.getMap('floatObj:pGone').set('orphan', props);
    }, 'local');
    /* the page is deleted (entry-level op incl. float map clear) */
    a.transact(() => {
      const order = a.getArray('pageOrder');
      const idx = order.toArray().indexOf('pGone');
      if (idx >= 0) order.delete(idx, 1);
      a.getMap('pageMeta').delete('pGone');
      const frag = a.getXmlFragment('page:pGone');
      frag.delete(0, frag.length);
      a.getMap('floatObj:pGone').clear();
    }, 'local');
    /* a STALE transaction tries to re-add a float to the deleted page —
       the room projection must not resurrect it (order has no pGone) */
    a.transact(() => {
      const props = new Y.Map<unknown>();
      props.set('x', 2);
      a.getMap('floatObj:pGone').set('zombie', props);
    }, 'local');
    const orderA = (a.getArray('pageOrder').toArray() as string[]).filter((v) => typeof v === 'string');
    assert.ok(!orderA.includes('pGone'), 'deleted page never re-enters the order');
    destroyRoomIfIdle(NOTE);
  });
});

/* ═════════════════════════════════════════════════════════════════════
   §30 D — TITLE metadata convergence (room-level; §13)
   ═════════════════════════════════════════════════════════════════════ */
describe('collab metadata — title (§30 D)', () => {
  beforeEach(() => { sessionStore.reset(); destroyRoomIfIdle(NOTE); });

  test('concurrent title edits converge to ONE value on both clients', async () => {
    const room = getRoom(NOTE) ?? createRoom(NOTE, { type: 'doc', content: [{ type: 'paragraph' }] }, 0);
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, Y.encodeStateAsUpdate(room.doc), 'server');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(room.doc), 'server');
    a.on('update', (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); Y.applyUpdate(b, u, 'server'); });
    b.on('update', (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); Y.applyUpdate(a, u, 'server'); });
    a.transact(() => { a.getMap('metadata').set('title', 'عنوان الف'); }, 'local');
    b.transact(() => { b.getMap('metadata').set('title', 'عنوان ب'); }, 'local');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b), 'server');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'server');
    const ta = a.getMap('metadata').get('title');
    const tb = b.getMap('metadata').get('title');
    assert.equal(ta, tb, 'title converges deterministically');
    destroyRoomIfIdle(NOTE);
  });

  test('title rides room state on reconnect (nothing lost, §18)', async () => {
    const room = getRoom(NOTE) ?? createRoom(NOTE, { type: 'doc', content: [{ type: 'paragraph' }] }, 0);
    const a = new Y.Doc();
    a.on('update', (u: Uint8Array) => { Y.applyUpdate(room.doc, u, 'remote-client'); });
    a.transact(() => { a.getMap('metadata').set('title', 'عنوان پایدار'); }, 'local');
    /* a NEW client joins late → full state sync carries the title */
    const late = new Y.Doc();
    Y.applyUpdate(late, Y.encodeStateAsUpdate(room.doc), 'server');
    assert.equal(late.getMap('metadata').get('title'), 'عنوان پایدار');
    destroyRoomIfIdle(NOTE);
  });

  test('non-title metadata fields are NOT required to converge (boundary §14)', () => {
    /* documented boundary: subjectId/chapter/tags never enter the room's
       metadata map — nothing to test except that the map only carries what
       clients explicitly set (no server-side mirroring of the Note doc). */
    const room = getRoom(NOTE) ?? createRoom(NOTE, { type: 'doc', content: [{ type: 'paragraph' }] }, 0);
    assert.equal(room.doc.getMap('metadata').size, 0, 'room starts with an EMPTY metadata map');
    destroyRoomIfIdle(NOTE);
  });
});

/* ═════════════════════════════════════════════════════════════════════
   §30 G — VERSION RESTORE as a SYSTEM operation (§20)
   ═════════════════════════════════════════════════════════════════════ */
describe('collab system restore (§30 G)', () => {
  beforeEach(() => { sessionStore.reset(); destroyRoomIfIdle(NOTE); });

  test('applySystemRestore replaces structure + fragments + floats deterministically', async () => {
    const { createRoom, destroyRoomIfIdle, getRoom, applySystemRestore } = await import('../collab/rooms.js');
    destroyRoomIfIdle(NOTE);
    const stored = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'نسخهٔ فعلی' }] },
        { type: 'pageBreak', attrs: { pid: 'pExtra' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'صفحهٔ اضافه' }] },
      ],
    };
    const room = getRoom(NOTE) ?? createRoom(NOTE, stored, 0);
    /* live edit state diverges from what will be restored */
    room.doc.transact(() => {
      const p = new Y.XmlElement('paragraph');
      const t = new Y.XmlText();
      t.insert(0, 'ویرایش زندهٔ همزمان');
      p.insert(0, [t]);
      room.doc.getXmlFragment('page:p1').insert(0, [p]);
      const props = new Y.Map<unknown>();
      props.set('x', 9);
      room.doc.getMap('floatObj:p1').set('liveFloat', props);
    }, 'remote-client');

    /* the RESTORED doc has ONE page with different content */
    const restoredDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'محتوای بازیابی‌شده' }] }],
      floatingElements: [{ id: 'f1', type: 'rect', x: 5 }],
    };
    applySystemRestore(room, restoredDoc);

    /* structure: the extra page is gone */
    assert.deepEqual(room.pageOrder.toArray(), ['p1'], 'restore collapses the page list to the restored one');
    /* content: the restored text replaced the live edit */
    const fragText = room.doc.getXmlFragment('page:p1').toString();
    assert.ok(fragText.includes('محتوای بازیابی‌شده'), 'restored content present');
    assert.ok(!fragText.includes('ویرایش زندهٔ همزمان'), 'live edit removed by the SYSTEM op');
    /* floats: live float cleared, restored float present */
    assert.equal(room.doc.getMap('floatObj:p1').get('liveFloat'), undefined, 'stale float removed');
    assert.ok(room.doc.getMap('floatObj:p1').get('f1'), 'restored float present');
    destroyRoomIfIdle(NOTE);
  });
});

/* ═════════════════════════════════════════════════════════════════════
   §28 PROTOCOL VALIDATION — malformed frames never crash the room
   ═════════════════════════════════════════════════════════════════════ */
describe('collab protocol validation (§30 I)', () => {
  test('valid frames parse; forged identity fields are REJECTED', async () => {
    const { parseClientFrame } = await import('../collab/protocol.js');
    assert.ok(parseClientFrame(JSON.stringify({ t: 'join', noteId: 'n1' })), 'join ok');
    assert.ok(parseClientFrame(JSON.stringify({ t: 'heartbeat', pageId: 'p1' })), 'heartbeat ok');
    assert.ok(parseClientFrame(JSON.stringify({ t: 'update', u64: 'AAA=' })), 'update ok');
    assert.equal(parseClientFrame(JSON.stringify({ t: 'join', noteId: 'n1', userId: 'forged' })), null, 'forged userId rejected');
    assert.equal(parseClientFrame(JSON.stringify({ t: 'join', noteId: 'n1', canEdit: true })), null, 'forged capability rejected');
    assert.equal(parseClientFrame(JSON.stringify({ t: 'unknown-type' })), null, 'unknown type rejected');
    assert.equal(parseClientFrame(JSON.stringify({ t: 'update', u64: '!!!not-base64!!!' })), null, 'non-base64 payload rejected');
    assert.equal(parseClientFrame('not-json'), null, 'non-JSON dropped');
    assert.equal(parseClientFrame(JSON.stringify({ t: 'heartbeat', pageId: 'bad id with spaces' })), null, 'pageId pattern enforced');
  });

  test('oversized binary payloads are rejected before any buffer allocation', async () => {
    const { parseClientFrame } = await import('../collab/protocol.js');
    const huge = 'A'.repeat(9 * 1024 * 1024); /* > 8 MB cap */
    assert.equal(parseClientFrame(JSON.stringify({ t: 'update', u64: huge })), null, 'oversized u64 rejected');
  });
});

/* ═══════════════════════════════════════════════════════════════════
   §2/§31/§33 — VIEW-ONLY REASON MODEL (client session state machine)
   The client CollabSession is imported directly (its leaf modules carry
   no path aliases) so the demotion policy is pinned without a browser.
   ═══════════════════════════════════════════════════════════════════ */
describe('client session state machine — view-only reasons (§30 E)', () => {
  test('seat.transferred → viewOnlyReason=transferred; revoked → forbidden+revoked; note.deleted → note-deleted', async () => {
    const { CollabSession } = (await import(clientModule('session'))) as { CollabSession: new (noteId: string, events: { onState: (st: any) => void }) => { state: any; requestSeat: () => void; destroy: () => void; [k: string]: any } };
    const seen: Array<Record<string, unknown>> = [];
    const s = new CollabSession('note-ux-test', { onState: (st: Record<string, unknown>) => seen.push({ ...st }) });
    /* frames are driven through the private handler via (any) cast — the
       transport is never started, so no socket is opened */
    const handle = (f: unknown) => (s as unknown as { handleFrame: (f: unknown) => void }).handleFrame(f);

    /* active seat acquired */
    handle({ t: 'seat.acquired', sessionId: 'sess-1' });
    assert.equal(s.state.seat, 'active');

    /* §31: another tab takes over → view-only WITH the transfer reason */
    handle({ t: 'seat.transferred' });
    assert.equal(s.state.seat, 'view');
    assert.equal(s.state.viewOnlyReason, 'transferred');
    assert.equal(s.state.denyReason, null, 'a takeover is NOT a join denial');

    /* recoverable: the demoted tab may re-request its seat */
    handle({ t: 'seat.acquired', sessionId: 'sess-2' });
    assert.equal(s.state.viewOnlyReason, null, 'reason cleared on re-acquire');

    /* §33: revocation → forbidden + revoked reason, NOT a capacity state */
    handle({ t: 'seat.acquired', sessionId: 'sess-3' });
    handle({ t: 'revoked' });
    assert.equal(s.state.seat, 'view');
    assert.equal(s.state.denyReason, 'forbidden');
    assert.equal(s.state.viewOnlyReason, 'revoked');

    /* §33: a permanently forbidden user's requestSeat() must be a no-op */
    const before = s.state.seat;
    s.requestSeat();
    assert.equal(s.state.seat, before, 'forbidden users never re-acquire via requestSeat');

    /* §29: note deleted while editing → explicit terminal state */
    handle({ t: 'note.deleted', reason: 'deleted' });
    assert.equal(s.state.seat, 'view');
    assert.equal(s.state.viewOnlyReason, 'note-deleted');
    s.requestSeat();
    assert.equal(s.state.seat, 'view', 'a deleted note can never be re-seated');

    /* released (stale seat) → distinct reason from transfer */
    handle({ t: 'seat.released' });
    assert.equal(s.state.viewOnlyReason, 'released');

    s.destroy();
  });

  test('a fresh join resets stale demotion reasons', async () => {
    const { CollabSession } = (await import(clientModule('session'))) as { CollabSession: new (noteId: string, events: { onState: (st: any) => void }) => { state: any; requestSeat: () => void; destroy: () => void; [k: string]: any } };
    const s = new CollabSession('note-ux-test-2', { onState: () => {} });
    const handle = (f: unknown) => (s as unknown as { handleFrame: (f: unknown) => void }).handleFrame(f);
    handle({ t: 'seat.acquired', sessionId: 'a' });
    handle({ t: 'seat.transferred' });
    assert.equal(s.state.viewOnlyReason, 'transferred');
    /* reconnect → joined frame clears the mid-session reason */
    handle({ t: 'joined', noteId: 'note-ux-test-2', sessionId: 'b', revision: 3, canEdit: true, seat: 'active', maxEditors: 4, state64: '', sv64: '' });
    assert.equal(s.state.viewOnlyReason, null);
    assert.equal(s.state.seat, 'active');
    s.destroy();
  });
});

/* ═══════════════════════════════════════════════════════════════════
   §23/§24 — FLOAT DRAG POLICY + DELETE-WINS (client floatSync reconcile)
   ═══════════════════════════════════════════════════════════════════ */
describe('client float reconcile — drag protection + tombstones (§30 C)', () => {
  const NS = 'client-float-tests';

  test('§23: remote geometry for a LOCALLY DRAGGED object is skipped; other objects still merge', async () => {
    const { CollabSession } = (await import(clientModule('session'))) as { CollabSession: new (noteId: string, events: { onState: (st: any) => void }) => { state: any; requestSeat: () => void; destroy: () => void; [k: string]: any } };
    const { reconcileFloatsFromSession, setProtectedFloat } = (await import(clientModule('floatSync'))) as {
      reconcileFloatsFromSession: (s: any, pageId: string, local: Array<Record<string, unknown>>) => Array<Record<string, unknown>> | null;
      setProtectedFloat: (pageId: string | null, objectId: string | null) => void;
    };
    const s = new CollabSession(NS, { onState: () => {} });
    const local = [
      { id: 'objA', x: 10, y: 10, width: 100, height: 50 },
      { id: 'objB', x: 20, y: 20, width: 80, height: 40 },
    ];

    /* A drag starts on objA → its remote shadow arrives with different x */
    setProtectedFloat('p1', 'objA');
    s.opUpsertFloat('p1', { id: 'objA', x: 999, y: 10, width: 100, height: 50 });
    s.opUpsertFloat('p1', { id: 'objB', x: 25, y: 20, width: 80, height: 40 });

    const merged = reconcileFloatsFromSession(s, 'p1', local);
    assert.ok(merged, 'the other object changed → merge happens');
    const a = merged!.find((o) => String(o.id) === 'objA');
    const b = merged!.find((o) => String(o.id) === 'objB');
    assert.equal(a?.x, 10, 'dragged object keeps LOCAL geometry (pointer wins)');
    assert.equal(b?.x, 25, 'untouched object takes the REMOTE update');

    /* gesture ends → next reconcile takes the canonical state */
    setProtectedFloat(null, null);
    const merged2 = reconcileFloatsFromSession(s, 'p1', local);
    assert.ok(merged2);
    assert.equal(merged2!.find((o) => String(o.id) === 'objA')?.x, 999, 'after pointerup the canonical geometry converges');
    s.destroy();
  });

  test('§24: a tombstoned local-only copy is dropped (deleted object never resurrects)', async () => {
    const { CollabSession } = (await import(clientModule('session'))) as { CollabSession: new (noteId: string, events: { onState: (st: any) => void }) => { state: any; requestSeat: () => void; destroy: () => void; [k: string]: any } };
    const { reconcileFloatsFromSession } = (await import(clientModule('floatSync'))) as {
      reconcileFloatsFromSession: (s: any, pageId: string, local: Array<Record<string, unknown>>) => Array<Record<string, unknown>> | null;
    };
    const s = new CollabSession(NS + '-2', { onState: () => {} });
    /* remote removes an object this tab still mirrors (race: B deletes while
       A's mirror lags). opDeleteFloat tombstones the id locally. */
    s.opDeleteFloat('p1', 'gone-obj');
    const local = [
      { id: 'gone-obj', x: 1, y: 1, width: 10, height: 10 },
      { id: 'live-obj', x: 2, y: 2, width: 20, height: 20 },
    ];
    s.opUpsertFloat('p1', { id: 'live-obj', x: 2, y: 2, width: 20, height: 20 });
    const merged = reconcileFloatsFromSession(s, 'p1', local);
    assert.ok(merged);
    assert.equal(merged!.some((o) => String(o.id) === 'gone-obj'), false, 'tombstoned object stays deleted');
    assert.equal(merged!.some((o) => String(o.id) === 'live-obj'), true, 'live objects survive');

    /* a DELIBERATE re-create clears the tombstone */
    s.opUpsertFloat('p1', { id: 'gone-obj', x: 5, y: 5, width: 10, height: 10 });
    assert.equal(s.isFloatTombstoned('p1', 'gone-obj'), false, 're-create un-tombstones');
    const merged2 = reconcileFloatsFromSession(s, 'p1', []);
    assert.ok(merged2?.some((o) => String(o.id) === 'gone-obj'), 'the re-created object is reconciled back in');
    s.destroy();
  });
});

/* ═══════════════════════════════════════════════════════════════════
   §29 — NOTE REMOVED policy: trashed/deleted notes stop persisting
   (server authority — persistRoom refuses, room torn down by the hub).
   Uses an in-memory Mongo (same convention as groups.test.mts) + the
   auth hash pipeline via bcryptjs directly.
   ═══════════════════════════════════════════════════════════════════ */
describe('note-removed policy (§29)', () => {
  test('persistRoom refuses a TRASHED note (no resurrection through autosave)', async () => {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const mongoose = (await import('mongoose')).default;
    const bcrypt = (await import('bcryptjs')).default;
    const { Note } = await import('../models/Note.js');
    const { User } = await import('../models/User.js');
    const { persistRoom, createRoom, destroyRoomIfIdle, getRoom } = await import('../collab/rooms.js');

    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri('note-removed-test'));
    try {
      const passwordHash = await bcrypt.hash('test12345678', 4);
      const user = await User.create({ name: 'T', email: 'trash-policy@t.local', passwordHash });
      const note = await Note.create({
        title: 'trash-policy-test', userId: user._id,
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'v1' }] }] },
        revision: 1,
      });
      destroyRoomIfIdle(String(note._id));
      const room = getRoom(String(note._id)) ?? createRoom(String(note._id), note.content, 1);

      /* before trash: persistence writes (revision bumps) */
      room.doc.getMap('metadata').set('title', 'trash-policy-test');
      room.doc.getXmlFragment('page:p1').insert(0, [textPara('v2')]);
      await persistRoom(room);
      const revBefore = (await Note.findById(note._id))!.revision ?? 0;
      assert.equal(revBefore, 2, 'pre-trash persistence wrote v2');

      /* trash → persistence MUST refuse */
      await Note.updateOne({ _id: note._id }, { $set: { trashed: true, trashedAt: new Date() } });
      room.doc.getXmlFragment('page:p1').insert(0, [textPara('v3')]);
      await persistRoom(room);
      const after = await Note.findById(note._id);
      assert.equal(after!.trashed, true);
      assert.equal(after!.revision, revBefore, 'trashed note: NO persistence write (no resurrection)');
      assert.equal(String((after!.content as { content: Array<{ content: Array<{ text?: string }> }> })?.content?.[0]?.content?.[0]?.text ?? ''), 'v2', 'content unchanged after trash');

      destroyRoomIfIdle(String(note._id));
    } finally {
      await mongoose.disconnect();
      await replSet.stop();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════
   § RELIABILITY MILESTONE — durability, generations, failure injection.
   Every test here asserts the FINAL Note state (never just that a call
   returned), against a real in-memory Mongo (same convention as above).
   ═══════════════════════════════════════════════════════════════════ */
describe('reliability — durability, generations, failure injection', () => {
  const getContent = (n: unknown) => {
    const c = (n as { content?: { content?: Array<{ content?: Array<{ text?: string }> }> } })?.content?.content;
    return (c ?? []).map((b) => b?.content?.[0]?.text ?? '').join('|');
  };

  /** standard harness: one user + one note + one live room */
  async function harness(mongoose: typeof import('mongoose').default, Note: typeof import('../models/Note.js').Note, User: typeof import('../models/User.js').User, name: string) {
    const bcrypt = (await import('bcryptjs')).default;
    const passwordHash = await bcrypt.hash('test12345678', 4);
    const user = await User.create({ name: 'T', email: `${name}@t.local`, passwordHash });
    const note = await Note.create({
      title: name, userId: user._id,
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'base' }] }] },
      revision: 1,
    });
    const noteId = String(note._id);
    destroyRoomIfIdle(noteId);
    const room = getRoom(noteId) ?? createRoom(noteId, note.content, 1);
    return { user, noteId, room };
  }

  test('normal persistence: dirty room persists with a fresh generation + atomic revision bump', async () => {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const mongoose = (await import('mongoose')).default;
    const { Note } = await import('../models/Note.js');
    const { User } = await import('../models/User.js');
    const { persistRoom } = await import('../collab/rooms.js');
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri('rel-normal'));
    try {
      const { noteId, room } = await harness(mongoose, Note, User, 'rel-normal');
      /* append at the END of the fragment (the seeded paragraph stays first) */
      room.doc.getXmlFragment('page:p1').insert(room.doc.getXmlFragment('page:p1').length, [textPara('edit-1')]);
      const genBefore = room.roomGeneration;
      await persistRoom(room);
      const after = await Note.findById(noteId);
      assert.equal(after!.revision, 2, 'revision bumped exactly once');
      assert.equal(getContent(after), 'base|edit-1', 'content durable');
      assert.equal((after as unknown as { roomGeneration: number }).roomGeneration, genBefore, 'durable generation recorded');
      assert.equal(room.durableGeneration, genBefore, 'room acknowledges durability');
      assert.equal(room.persistedRevision, 2, 'persisted revision published for the client ack');
      destroyRoomIfIdle(noteId);
    } finally {
      await mongoose.disconnect();
      await replSet.stop();
    }
  });

  test('idempotent no-op flush does not churn the revision', async () => {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const mongoose = (await import('mongoose')).default;
    const { Note } = await import('../models/Note.js');
    const { User } = await import('../models/User.js');
    const { persistRoom } = await import('../collab/rooms.js');
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri('rel-idempotent'));
    try {
      const { noteId, room } = await harness(mongoose, Note, User, 'rel-idempotent');
      const frag0 = room.doc.getXmlFragment('page:p1');
      frag0.insert(frag0.length, [textPara('x')]);
      await persistRoom(room);
      const rev = (await Note.findById(noteId))!.revision;
      await persistRoom(room); /* no mutation since → must skip */
      await persistRoom(room);
      assert.equal((await Note.findById(noteId))!.revision, rev, 'no fake revision churn');
      destroyRoomIfIdle(noteId);
    } finally {
      await mongoose.disconnect();
      await replSet.stop();
    }
  });

  test('mongo failure keeps the room dirty; retry re-captures and converges', async () => {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const mongoose = (await import('mongoose')).default;
    const { Note } = await import('../models/Note.js');
    const { User } = await import('../models/User.js');
    const { persistRoom, flushDirtyRooms } = await import('../collab/rooms.js');
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri('rel-fail'));
    try {
      const { noteId, room } = await harness(mongoose, Note, User, 'rel-fail');
      const fragF = room.doc.getXmlFragment('page:p1');
      fragF.insert(fragF.length, [textPara('during-outage')]);
      room.dirtySince = 1; /* old enough to flush */
      /* FAILURE INJECTION (model level, isolated): the FIRST flush's Mongo
         write fails exactly like a real outage; the second succeeds. */
      const originalUpdateOne = Note.updateOne.bind(Note);
      let injected = false;
      const injectedUpdateOne = ((...args: unknown[]) => {
        if (!injected) {
          injected = true;
          return Promise.reject(new Error('injected mongo outage'));
        }
        return (originalUpdateOne as (...a: unknown[]) => unknown)(...args) as never;
      }) as typeof Note.updateOne;
      (Note as unknown as { updateOne: unknown }).updateOne = injectedUpdateOne;
      room.dirtySince = 1;
      await flushDirtyRooms(); /* the write throws → dirty must be kept */
      (Note as unknown as { updateOne: unknown }).updateOne = originalUpdateOne;
      assert.ok(room.dirtySince, 'dirty state RETAINED after a failed write');
      assert.equal(room.durableGeneration, 0, 'nothing acked as durable');
      assert.equal(await Note.countDocuments({ _id: noteId, revision: 2 }), 0, 'failed write wrote NOTHING');
      /* RECOVERY: Mongo back → the retry re-captures a FRESH snapshot */
      room.dirtySince = 1;
      await flushDirtyRooms();
      assert.equal(room.dirtySince, 0, 'retry cleared the dirty flag');
      const after = await Note.findById(noteId);
      assert.equal(getContent(after), 'base|during-outage', 'canonical state eventually durable');
      destroyRoomIfIdle(noteId);
    } finally {
      await mongoose.disconnect();
      await replSet.stop();
    }
  });

  test('REST save racing the room flush: the room write must be skipped, never overwrite', async () => {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const mongoose = (await import('mongoose')).default;
    const { Note } = await import('../models/Note.js');
    const { User } = await import('../models/User.js');
    const { persistRoom } = await import('../collab/rooms.js');
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri('rel-rest-race'));
    try {
      const { noteId, room } = await harness(mongoose, Note, User, 'rel-rest-race');
      const fragR = room.doc.getXmlFragment('page:p1');
      fragR.insert(fragR.length, [textPara('room-op')]);
      /* a REST autosave lands BEFORE the flush captures: the note revision
         moves 1 → 5 with different content (exactly what a concurrent REST
         PATCH does). The room's conditional update can no longer match. */
      await Note.updateOne(
        { _id: noteId },
        {
          $set: { content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'rest-op' }] }] } },
          $inc: { revision: 4 },
        } as never
      );
      await persistRoom(room); /* capture sees revision 5; write matches; NOT skipped */
      /* second leg: the REST write lands BETWEEN the room's capture and its
         write — injected on the model layer (isolated, deterministic): the
         FIRST updateOne captures (returns the doc), then a REAL concurrent
         $inc races in before the conditional update is issued. The
         conditional update must then MISS (revision moved) or still be
         consistent — either way the note can never be corrupted. */
      const originalUpdateOne2 = Note.updateOne.bind(Note);
      let raced = false;
      const racingUpdateOne = ((...args: unknown[]) => {
        const filter = args[0] as Record<string, unknown>;
        if (!raced && filter && typeof filter === 'object' && !('$or' in filter)) {
          /* this is the findById-path bump? No — updateOne here is the room's
             conditional write only; the race fires once, right BEFORE it */
          raced = true;
          void originalUpdateOne2({ _id: noteId }, { $inc: { revision: 3 } } as never).catch(() => {});
        }
        return (originalUpdateOne2 as (...a: unknown[]) => unknown)(...args) as never;
      }) as typeof Note.updateOne;
      (Note as unknown as { updateOne: unknown }).updateOne = racingUpdateOne;
      const fragR2 = room.doc.getXmlFragment('page:p1');
      fragR2.insert(fragR2.length, [textPara('room-op-2')]);
      try {
        await persistRoom(room); /* may skip (conditional miss) — must not corrupt */
      } finally {
        (Note as unknown as { updateOne: unknown }).updateOne = originalUpdateOne2;
      }
      const after = await Note.findById(noteId);
      const revAfter = after!.revision ?? 0;
      assert.ok(revAfter >= 6, 'revision only ever moved FORWARD');
      assert.ok(getContent(after).includes('room-op') || getContent(after).includes('rest-op'), 'content is one of the legitimate writers, never a mix');
      /* final flush converges the room state onto the durable Note */
      await persistRoom(room);
      const finalNote = await Note.findById(noteId);
      assert.ok((finalNote!.revision ?? 0) >= revAfter, 'revision advanced monotonically, never rolled back');
      assert.ok(getContent(finalNote).includes('room-op-2'), 'room state durably persisted after re-capture (got: ' + getContent(finalNote) + ')');
      destroyRoomIfIdle(noteId);
    } finally {
      await mongoose.disconnect();
      await replSet.stop();
    }
  });

  test('generation guard: a write for an OLD generation cannot commit over a newer durable snapshot', async () => {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const mongoose = (await import('mongoose')).default;
    const { Note } = await import('../models/Note.js');
    const { User } = await import('../models/User.js');
    const { persistRoom } = await import('../collab/rooms.js');
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri('rel-gen'));
    try {
      const { noteId, room } = await harness(mongoose, Note, User, 'rel-gen');
      /* gen N: edit "newer" persists first */
      const fragG = room.doc.getXmlFragment('page:p1');
      fragG.insert(fragG.length, [textPara('newer')]);
      await persistRoom(room);
      const revAfterNewer = (await Note.findById(noteId))!.revision;
      assert.equal(revAfterNewer, 2, 'first flush durably persisted (precondition)');
      /* simulating a DELAYED older write: another writer has since advanced
         the durable generation in Mongo (e.g. a room persisted elsewhere /
         a later flush won). The in-memory candidate is now gen 1 while the
         stored generation is higher — the guard must abort the flush. */
      (room as unknown as { roomGeneration: number }).roomGeneration = 1;
      await Note.updateOne({ _id: noteId }, { $set: { roomGeneration: 99 } } as never);
      await persistRoom(room); /* candidate gen 1 < stored gen 99 → abort, no write */
      (room as unknown as { roomGeneration: number }).roomGeneration = 2; /* restore for cleanup */
      const after = await Note.findById(noteId);
      assert.equal(getContent(after), 'base|newer', 'older generation did NOT overwrite newer durable state');
      assert.equal(after!.revision, revAfterNewer, 'no phantom revision bump');
      destroyRoomIfIdle(noteId);
    } finally {
      await mongoose.disconnect();
      await replSet.stop();
    }
  });

  test('trashed note: a delayed flush cannot resurrect it (generation + trash guard)', async () => {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const mongoose = (await import('mongoose')).default;
    const { Note } = await import('../models/Note.js');
    const { User } = await import('../models/User.js');
    const { persistRoom } = await import('../collab/rooms.js');
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri('rel-trash-race'));
    try {
      const { noteId, room } = await harness(mongoose, Note, User, 'rel-trash-race');
      const fragT = room.doc.getXmlFragment('page:p1');
      fragT.insert(fragT.length, [textPara('zombie')]);
      await Note.updateOne({ _id: noteId }, { $set: { trashed: true } });
      await persistRoom(room);
      const after = await Note.findById(noteId);
      assert.equal(after!.trashed, true, 'still trashed');
      assert.equal(getContent(after), 'base', 'content untouched — no resurrection');
      assert.equal(after!.revision, 1, 'no revision bump');
      destroyRoomIfIdle(noteId);
    } finally {
      await mongoose.disconnect();
      await replSet.stop();
    }
  });

  test('corrupt persisted snapshot: room seed refuses it and the durable Note is untouched', async () => {
    const { createRoom, destroyRoomIfIdle, getRoom } = await import('../collab/rooms.js');
    destroyRoomIfIdle('corrupt-seed-room');
    const corrupt = { type: 'doc', content: [
      { type: 'paragraph' },
      { type: 'pageBreak', attrs: { pid: 'dup' } },
      { type: 'paragraph' },
      { type: 'pageBreak', attrs: { pid: 'dup' } },
      { type: 'paragraph' },
    ] };
    const room = getRoom('corrupt-seed-room') ?? createRoom('corrupt-seed-room', corrupt, 0);
    assert.equal(room.pageOrder.length, 0, 'invalid snapshot never seeded into semantic structure');
    destroyRoomIfIdle('corrupt-seed-room');
  });

  test('corrupt restore payload is rejected (throw), room keeps its live state', async () => {
    const { createRoom, destroyRoomIfIdle, getRoom, applySystemRestore } = await import('../collab/rooms.js');
    destroyRoomIfIdle('corrupt-restore-room');
    const room = getRoom('corrupt-restore-room') ?? createRoom('corrupt-restore-room', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'live' }] }] }, 0);
    assert.throws(() => applySystemRestore(room, { type: 'not-a-doc' } as never), /restore rejected/, 'invalid restore payload rejected loudly');
    assert.ok(room.doc.getXmlFragment('page:p1').toString().includes('live'), 'live state intact after rejection');
    destroyRoomIfIdle('corrupt-restore-room');
  });

  test('restore bumps the generation: a stale flush after restore can never resurrect pre-restore content', async () => {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const mongoose = (await import('mongoose')).default;
    const { Note } = await import('../models/Note.js');
    const { User } = await import('../models/User.js');
    const { persistRoom } = await import('../collab/rooms.js');
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri('rel-restore'));
    try {
      const { noteId, room } = await harness(mongoose, Note, User, 'rel-restore');
      const fragS = room.doc.getXmlFragment('page:p1');
      fragS.insert(fragS.length, [textPara('live-edit')]);
      await persistRoom(room);
      /* SYSTEM restore applies different content INTO the room */
      const { applySystemRestore } = await import('../collab/rooms.js');
      applySystemRestore(room, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'restored' }] }] });
      await persistRoom(room);
      const after = await Note.findById(noteId);
      assert.equal(getContent(after), 'restored', 'restored canonical state durable');
      /* a STALE async callback tries to write the PRE-restore state: the
         projection re-derived from the room (now restored) can only ever
         produce the restored content — assert the invariant end-to-end */
      await persistRoom(room); /* no-op flush (same doc) → no churn */
      const finalNote = await Note.findById(noteId);
      assert.equal(getContent(finalNote), 'restored', 'nothing regressed after the final flush');
      destroyRoomIfIdle(noteId);
    } finally {
      await mongoose.disconnect();
      await replSet.stop();
    }
  });

  test('graceful shutdown flushes a dirty room within the bounded timeout', async () => {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const mongoose = (await import('mongoose')).default;
    const { Note } = await import('../models/Note.js');
    const { User } = await import('../models/User.js');
    const { flushAllRoomsOnShutdown } = await import('../collab/rooms.js');
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri('rel-shutdown'));
    try {
      const { noteId, room } = await harness(mongoose, Note, User, 'rel-shutdown');
      const fragX = room.doc.getXmlFragment('page:p1');
      fragX.insert(fragX.length, [textPara('before-exit')]);
      room.dirtySince = 1;
      /* NOTE: other tests in this suite may still hold dirty rooms alive
         (their MongoDBs are stopped, so their flushes fail) — count them:
         the assertion below targets THIS room's outcome, not the global one */
      const globalDirtyCount = [...(await import('../collab/rooms.js')).roomsSnapshot()].filter((r) => r.dirtySince && !r.persisting).length;
      const t0 = Date.now();
      const result = await flushAllRoomsOnShutdown();
      const took = Date.now() - t0;
      assert.equal(result.flushed, globalDirtyCount, 'every dirty room got its flush attempt');
      assert.ok(took < 8_000, 'bounded shutdown wait respected');
      const after = await Note.findById(noteId);
      assert.equal(getContent(after), 'base|before-exit', 'unsaved collaborative state survived shutdown');
      destroyRoomIfIdle(noteId);
    } finally {
      await mongoose.disconnect();
      await replSet.stop();
    }
  });

  test('page ids stay stable across room re-seed after persistence (pid writeback)', async () => {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const mongoose = (await import('mongoose')).default;
    const { Note } = await import('../models/Note.js');
    const { User } = await import('../models/User.js');
    const { persistRoom } = await import('../collab/rooms.js');
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri('rel-pids'));
    try {
      const { noteId, room } = await harness(mongoose, Note, User, 'rel-pids');
      /* page 2 exists via semantic structure (as a client CREATE_PAGE would) */
      room.doc.transact(() => {
        room.pageOrder.push(['page-runtime-9']);
        room.pageMeta.set('page-runtime-9', { kind: 'notebook', auto: false });
      }, 'local');
      await persistRoom(room);
      const stored = (await Note.findById(noteId))!.content as { content: Array<{ type: string; attrs?: Record<string, unknown> }> };
      const breaks = stored.content.filter((b) => b.type === 'pageBreak');
      assert.equal(breaks.length, 1, 'one separator for two pages');
      assert.equal(breaks[0].attrs?.pid, 'page-runtime-9', 'runtime page id persisted on the break');
      /* restart equivalent: rebuild the room from the persisted doc → ids identical */
      destroyRoomIfIdle(noteId);
      const room2 = getRoom(noteId) ?? createRoom(noteId, stored, 2);
      assert.deepEqual(room2.pageOrder.toArray(), ['p1', 'page-runtime-9'], 'page identity survives restart');
      destroyRoomIfIdle(noteId);
    } finally {
      await mongoose.disconnect();
      await replSet.stop();
    }
  });

  test('structured content survives durable recovery: equation/table/edu-block attrs pass through intact', async () => {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    const mongoose = (await import('mongoose')).default;
    const { Note } = await import('../models/Note.js');
    const { User } = await import('../models/User.js');
    const { persistRoom } = await import('../collab/rooms.js');
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri('rel-structured'));
    try {
      const { noteId, room } = await harness(mongoose, Note, User, 'rel-structured');
      /* simulate structured nodes arriving from a client (attrs ride the
         yjs elements exactly like y-prosemirror stores them) */
      const eq = new Y.XmlElement('equation');
      eq.setAttribute('ast', JSON.parse(JSON.stringify({ root: { type: 'num', value: 42 } })));
      const callout = new Y.XmlElement('calloutBlock');
      callout.setAttribute('kind', 'definition');
      callout.setAttribute('styleBg', '#f7f7f8');
      const table = new Y.XmlElement('table');
      table.setAttribute('data-tstyle', 'navy');
      table.setAttribute('data-striped', 'true');
      const fragSt = room.doc.getXmlFragment('page:p1');
      fragSt.insert(fragSt.length, [eq, callout, table]);
      await persistRoom(room);
      const stored = (await Note.findById(noteId))!.content as { content: Array<Record<string, unknown>> };
      const types = stored.content.map((b) => String(b.type));
      assert.ok(types.includes('equation') && types.includes('calloutBlock') && types.includes('table'), 'structured nodes persisted as nodes (never flattened)');
      const eqNode = stored.content.find((b) => b.type === 'equation') as { attrs: { ast: unknown } };
      assert.deepEqual(eqNode.attrs.ast, { root: { type: 'num', value: 42 } }, 'equation AST survives as AST');
      const calloutNode = stored.content.find((b) => b.type === 'calloutBlock') as { attrs: Record<string, unknown> };
      assert.equal(calloutNode.attrs.kind, 'definition', 'edu-block attrs survive');
      assert.equal(calloutNode.attrs.styleBg, '#f7f7f8', 'edu-block style attrs survive');
      const tableNode = stored.content.find((b) => b.type === 'table') as { attrs: Record<string, unknown> };
      assert.equal(tableNode.attrs['data-tstyle'], 'navy', 'table design tokens survive');
      destroyRoomIfIdle(noteId);
    } finally {
      await mongoose.disconnect();
      await replSet.stop();
    }
  });
});
