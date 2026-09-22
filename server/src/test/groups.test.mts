/**
 * Focused Group-foundation tests — node:test + in-memory MongoDB.
 * Run:  npm run test:groups -w server
 *
 * Covers the acceptance matrix: CREATE (atomicity, auth, validation),
 * READ (authorization), UPDATE (permission policy), MEMBERS (role mgmt,
 * owner protection), DATA (uniqueness constraints).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

/* isolate env BEFORE importing app code (same convention as config/env.ts) */
delete process.env.PORT;
process.env.ALLOW_DB_FALLBACK = 'false';
process.env.SEED_ON_START = 'false';
const envDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const candidate of [path.join(envDir, '.env'), path.join(envDir, '..', '.env')]) {
  if (existsSync(candidate)) dotenv.config({ path: candidate, override: true });
}

/* ── build a MINIMAL app wired exactly like src/index.ts ──────────────── */
async function buildApp() {
  const { errorHandler, notFound } = await import('../middleware/error.js');
  const authRoutes = (await import('../routes/auth.js')).default;
  const groupRoutes = (await import('../routes/groups.js')).default;

  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/groups', groupRoutes);
  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}

let replSet: MongoMemoryReplSet;
let app: express.Express;

const EMAIL_SEQ = { n: 0 };
async function registerAndGetToken(email = `u${++EMAIL_SEQ.n}@t.local`, name = 'کاربر تست') {
  const res = await request(app).post('/api/auth/register').send({ name, email, password: 'test12345678' });
  assert.equal(res.status, 201, `register failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, userId: res.body.user.id as string };
}

describe('Group foundation', () => {
  before(async () => {
    /* MongoMemoryReplSet: the group service uses MongoDB TRANSACTIONS (§3
     * atomic create), which standalone mongod rejects — run a real one-node
     * replica set like production. `waitUntilPrimary` resolves only after
     * the set is writable, so mongoose.connect cannot race the election. */
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    /* create() already starts the set; waitUntilRunning() resolves once the
     * instance is up (mongoose itself waits for the PRIMARY on connect) */
    await replSet.waitUntilRunning();
    await mongoose.connect(replSet.getUri('groups-test'));
    app = await buildApp();
  });

  after(async () => {
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  /* ── CREATE ─────────────────────────────────────────────────────────── */
  describe('CREATE', () => {
    it('authenticated user can create a group; owner membership created atomically', async () => {
      const { token, userId } = await registerAndGetToken();
      const res = await request(app).post('/api/groups').set('Authorization', `Bearer ${token}`).send({ name: 'گروه فیزیولوژی' });
      assert.equal(res.status, 201);
      const g = res.body.group;
      assert.equal(g.name, 'گروه فیزیولوژی');
      assert.equal(g.ownerId, userId);
      assert.equal(g.myRole, 'owner');
      assert.equal(g.myStatus, 'active');
      assert.equal(g.memberCount, 1);

      const { GroupMembership } = await import('../models/GroupMembership.js');
      const ownerMembership = await GroupMembership.findOne({ groupId: g.id, userId, role: 'owner', status: 'active' });
      assert.ok(ownerMembership, 'owner membership row must exist');

      const { Group } = await import('../models/Group.js');
      const raw = await Group.findById(g.id);
      assert.ok(raw);
      assert.equal(String(raw.ownerId), userId);
    });

    it('unauthenticated user cannot create a group', async () => {
      const res = await request(app).post('/api/groups').send({ name: 'گروه مخفی' });
      assert.equal(res.status, 401);
    });

    it('invalid group data is rejected (name too short, bad avatar, bad ids)', async () => {
      const { token } = await registerAndGetToken();
      const short = await request(app).post('/api/groups').set('Authorization', `Bearer ${token}`).send({ name: 'گ' });
      assert.equal(short.status, 400);

      const badAvatar = await request(app)
        .post('/api/groups')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'گروه معتبر', avatar: 'data:text/html;base64,PGI+' });
      assert.equal(badAvatar.status, 400);

      const badId = await request(app).get('/api/groups/not-an-objectid').set('Authorization', `Bearer ${token}`);
      assert.equal(badId.status, 400);
    });

    it('duplicate group creation from double submission does not corrupt state', async () => {
      const { token } = await registerAndGetToken();
      const payload = { name: 'گروه تکراری', description: '' };
      const [a, b] = await Promise.all([
        request(app).post('/api/groups').set('Authorization', `Bearer ${token}`).send(payload),
        request(app).post('/api/groups').set('Authorization', `Bearer ${token}`).send(payload),
      ]);
      /* both may succeed (two distinct groups) or one 4xx — but never a 500
         and never a group without an owner membership */
      for (const r of [a, b]) {
        if (r.status === 201) {
          const { GroupMembership } = await import('../models/GroupMembership.js');
          const om = await GroupMembership.findOne({ groupId: r.body.group.id, role: 'owner', status: 'active' });
          assert.ok(om, 'every created group must have an owner membership');
        } else {
          assert.ok(r.status >= 400 && r.status < 500, `unexpected status ${r.status}`);
        }
      }
    });
  });

  /* ── READ ───────────────────────────────────────────────────────────── */
  describe('READ', () => {
    it('owner can read group; active member can read; unrelated user cannot; removed user cannot', async () => {
      const owner = await registerAndGetToken();
      const member = await registerAndGetToken();
      const stranger = await registerAndGetToken();

      const created = await request(app).post('/api/groups').set('Authorization', `Bearer ${owner.token}`).send({ name: 'گروه خواندن' });
      const gid = created.body.group.id as string;

      /* direct membership insertion = stand-in for the future invitation flow */
      const { GroupMembership } = await import('../models/GroupMembership.js');
      await GroupMembership.create({ groupId: gid, userId: member.userId, role: 'member', status: 'active', joinedAt: new Date() });

      assert.equal((await request(app).get(`/api/groups/${gid}`).set('Authorization', `Bearer ${owner.token}`)).status, 200);
      assert.equal((await request(app).get(`/api/groups/${gid}`).set('Authorization', `Bearer ${member.token}`)).status, 200);
      assert.equal((await request(app).get(`/api/groups/${gid}`).set('Authorization', `Bearer ${stranger.token}`)).status, 403);

      const m = await GroupMembership.findOne({ groupId: gid, userId: member.userId });
      m!.status = 'removed';
      m!.leftAt = new Date();
      await m!.save();
      assert.equal((await request(app).get(`/api/groups/${gid}`).set('Authorization', `Bearer ${member.token}`)).status, 403);

      /* My Groups no longer includes the removed group */
      const mine = await request(app).get('/api/groups').set('Authorization', `Bearer ${member.token}`);
      assert.equal(mine.status, 200);
      assert.ok(!mine.body.groups.some((g: { id: string }) => g.id === gid));
    });

    it('GET /groups returns only groups with active membership', async () => {
      const a = await registerAndGetToken();
      const b = await registerAndGetToken();
      await request(app).post('/api/groups').set('Authorization', `Bearer ${a.token}`).send({ name: 'گروه الف' });
      await request(app).post('/api/groups').set('Authorization', `Bearer ${b.token}`).send({ name: 'گروه ب' });

      const mine = await request(app).get('/api/groups').set('Authorization', `Bearer ${a.token}`);
      assert.equal(mine.body.groups.length, 1);
      assert.equal(mine.body.groups[0].name, 'گروه الف');
    });
  });

  /* ── UPDATE ─────────────────────────────────────────────────────────── */
  describe('UPDATE', () => {
    it('owner can update; admin can update; member cannot; stranger cannot', async () => {
      const owner = await registerAndGetToken();
      const admin = await registerAndGetToken();
      const member = await registerAndGetToken();

      const gid = (await request(app).post('/api/groups').set('Authorization', `Bearer ${owner.token}`).send({ name: 'گروه ویرایش' })).body.group.id as string;

      const { GroupMembership } = await import('../models/GroupMembership.js');
      await GroupMembership.create({ groupId: gid, userId: admin.userId, role: 'admin', status: 'active', joinedAt: new Date() });
      await GroupMembership.create({ groupId: gid, userId: member.userId, role: 'member', status: 'active', joinedAt: new Date() });

      const patch = { description: 'توضیحات جدید' };
      assert.equal((await request(app).patch(`/api/groups/${gid}`).set('Authorization', `Bearer ${owner.token}`).send(patch)).status, 200);
      assert.equal((await request(app).patch(`/api/groups/${gid}`).set('Authorization', `Bearer ${admin.token}`).send(patch)).status, 200);
      assert.equal((await request(app).patch(`/api/groups/${gid}`).set('Authorization', `Bearer ${member.token}`).send(patch)).status, 403);
      assert.equal((await request(app).patch(`/api/groups/${gid}`).set('Authorization', `Bearer ${owner.token}`).send({})).status, 400);
    });

    it('only model-supported fields change; unknown fields are dropped', async () => {
      const owner = await registerAndGetToken();
      const gid = (await request(app).post('/api/groups').set('Authorization', `Bearer ${owner.token}`).send({ name: 'گروه فیلدها' })).body.group.id as string;
      const res = await request(app).patch(`/api/groups/${gid}`).set('Authorization', `Bearer ${owner.token}`).send({ name: 'نام جدید', ownerId: adminHack() });
      assert.equal(res.status, 200);
      assert.notEqual(res.body.group.ownerId, adminHack());
      assert.equal(res.body.group.name, 'نام جدید');

      function adminHack() {
        /* an unrelated ObjectId — must never be accepted from the body */
        return '665f0c0c0c0c0c0c0c0c0c0c';
      }
    });
  });

  /* ── MEMBERS ────────────────────────────────────────────────────────── */
  describe('MEMBERS', () => {
    it('member list works; identity fields only', async () => {
      const owner = await registerAndGetToken(undefined, 'مالک');
      const gid = (await request(app).post('/api/groups').set('Authorization', `Bearer ${owner.token}`).send({ name: 'گروه اعضا' })).body.group.id as string;
      const res = await request(app).get(`/api/groups/${gid}/members`).set('Authorization', `Bearer ${owner.token}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.members.length, 1);
      assert.equal(res.body.members[0].role, 'owner');
      assert.equal(res.body.members[0].status, 'active');
      assert.ok(!('email' in res.body.members[0]), 'member list must not leak emails');
    });

    it('authorized role update works; unauthorized fails; owner role not settable; owner protected', async () => {
      const owner = await registerAndGetToken();
      const admin = await registerAndGetToken();
      const member = await registerAndGetToken();
      const member2 = await registerAndGetToken();

      const gid = (await request(app).post('/api/groups').set('Authorization', `Bearer ${owner.token}`).send({ name: 'گروه نقش‌ها' })).body.group.id as string;
      const { GroupMembership } = await import('../models/GroupMembership.js');
      await GroupMembership.create({ groupId: gid, userId: admin.userId, role: 'admin', status: 'active', joinedAt: new Date() });
      await GroupMembership.create({ groupId: gid, userId: member.userId, role: 'member', status: 'active', joinedAt: new Date() });
      await GroupMembership.create({ groupId: gid, userId: member2.userId, role: 'member', status: 'active', joinedAt: new Date() });

      /* owner promotes member → admin: OK */
      assert.equal((await request(app).patch(`/api/groups/${gid}/members/${member.userId}`).set('Authorization', `Bearer ${owner.token}`).send({ role: 'admin' })).status, 200);

      /* admin promotes member2 → admin: OK (admin manages members) */
      assert.equal((await request(app).patch(`/api/groups/${gid}/members/${member2.userId}`).set('Authorization', `Bearer ${admin.token}`).send({ role: 'admin' })).status, 200);

      /* member cannot change roles at all */
      assert.equal((await request(app).patch(`/api/groups/${gid}/members/${member2.userId}`).set('Authorization', `Bearer ${member.token}`).send({ role: 'admin' })).status, 403);

      /* role 'owner' is not an accepted value */
      assert.equal((await request(app).patch(`/api/groups/${gid}/members/${member.userId}`).set('Authorization', `Bearer ${owner.token}`).send({ role: 'owner' })).status, 400);

      /* admin cannot demote/promote another admin */
      assert.equal((await request(app).patch(`/api/groups/${gid}/members/${member.userId}`).set('Authorization', `Bearer ${admin.token}`).send({ role: 'member' })).status, 403);

      /* owner row itself is untouchable through member management */
      assert.equal((await request(app).patch(`/api/groups/${gid}/members/${owner.userId}`).set('Authorization', `Bearer ${admin.token}`).send({ role: 'member' })).status, 403);
      assert.equal((await request(app).delete(`/api/groups/${gid}/members/${owner.userId}`).set('Authorization', `Bearer ${admin.token}`)).status, 403);
    });

    it('member removal works for authorized users; owner cannot be removed; removed user loses access', async () => {
      const owner = await registerAndGetToken();
      const admin = await registerAndGetToken();
      const member = await registerAndGetToken();

      const gid = (await request(app).post('/api/groups').set('Authorization', `Bearer ${owner.token}`).send({ name: 'گروه حذف' })).body.group.id as string;
      const { GroupMembership } = await import('../models/GroupMembership.js');
      await GroupMembership.create({ groupId: gid, userId: admin.userId, role: 'admin', status: 'active', joinedAt: new Date() });
      await GroupMembership.create({ groupId: gid, userId: member.userId, role: 'member', status: 'active', joinedAt: new Date() });

      /* member cannot remove anyone */
      assert.equal((await request(app).delete(`/api/groups/${gid}/members/${admin.userId}`).set('Authorization', `Bearer ${member.token}`)).status, 403);

      /* admin removes member: OK */
      assert.equal((await request(app).delete(`/api/groups/${gid}/members/${member.userId}`).set('Authorization', `Bearer ${admin.token}`)).status, 200);
      const m = await GroupMembership.findOne({ groupId: gid, userId: member.userId });
      assert.equal(m!.status, 'removed');

      /* removed member cannot re-read the group */
      assert.equal((await request(app).get(`/api/groups/${gid}`).set('Authorization', `Bearer ${member.token}`)).status, 403);

      /* owner cannot be removed even by owner (route blocks owner target) */
      assert.equal((await request(app).delete(`/api/groups/${gid}/members/${owner.userId}`).set('Authorization', `Bearer ${owner.token}`)).status, 403);
    });
  });

  /* ── DATA ───────────────────────────────────────────────────────────── */
  describe('DATA', () => {
    it('duplicate active membership for the same group is prevented (unique index)', async () => {
      const owner = await registerAndGetToken();
      const gid = (await request(app).post('/api/groups').set('Authorization', `Bearer ${owner.token}`).send({ name: 'گروه یگانه' })).body.group.id as string;
      const { GroupMembership } = await import('../models/GroupMembership.js');
      await assert.rejects(
        () => GroupMembership.create({ groupId: gid, userId: owner.userId, role: 'member', status: 'active' }),
        (err: { code?: number }) => err.code === 11000
      );
    });

    it('group deletion (owner-only) removes memberships; admin deletion denied', async () => {
      const owner = await registerAndGetToken();
      const admin = await registerAndGetToken();
      const gid = (await request(app).post('/api/groups').set('Authorization', `Bearer ${owner.token}`).send({ name: 'گروه حذف‌شدنی' })).body.group.id as string;
      const { GroupMembership } = await import('../models/GroupMembership.js');
      await GroupMembership.create({ groupId: gid, userId: admin.userId, role: 'admin', status: 'active', joinedAt: new Date() });

      assert.equal((await request(app).delete(`/api/groups/${gid}`).set('Authorization', `Bearer ${admin.token}`)).status, 403);
      assert.equal((await request(app).delete(`/api/groups/${gid}`).set('Authorization', `Bearer ${owner.token}`)).status, 200);

      const left = await GroupMembership.find({ groupId: gid });
      assert.equal(left.length, 0);
    });

    it('group and membership remain consistent after create (no ownerless group)', async () => {
      const { Group } = await import('../models/Group.js');
      const { GroupMembership } = await import('../models/GroupMembership.js');
      const groups = await Group.find().lean();
      for (const g of groups) {
        const om = await GroupMembership.findOne({ groupId: g._id, role: 'owner', status: 'active' });
        assert.ok(om, `group ${String(g._id)} has no owner membership`);
      }
    });
  });
});
