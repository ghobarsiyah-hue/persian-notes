import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { User } from '../models/User.js';
import { Settings } from '../models/Settings.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler, ApiError } from '../middleware/error.js';
import { env } from '../config/env.js';

const router = Router();

const USERNAME_RE = /^[a-z0-9_-]{3,24}$/;

/** Email identity normalization — the SAME transform on every path that
 *  writes or looks up an email (register / login / duplicate check).
 *  Root cause of «با این اطلاعات نمی‌توانم لاگین کنم»: Mongo's unique index
 *  is byte-exact, so `Ali@Gmail.com` and `ali@gmail.com` (or a trailing
 *  space pasted from the mobile keyboard) were stored as two different
 *  identities — the later login arrived lowercased by the browser/IME and
 *  never matched the stored row. Trimming + lowercasing HERE (and in the
 *  login lookup below) makes one email = one account everywhere. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const registerSchema = z.object({
  name: z.string().min(2, 'نام باید حداقل ۲ حرف باشد').max(80),
  email: z.string().email('ایمیل معتبر نیست').max(200),
  /* length (not artificial complexity) is what makes passwords strong;
     12 ≈ far beyond brute-force reach with bcrypt cost 12 */
  password: z.string().min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد').max(128),
  /* آیدی — optional public handle at signup; validated + reserved later */
  username: z.string().regex(USERNAME_RE, 'آیدی باید ۳ تا ۲۴ کاراکتر لاتین، رقم، خط تیره یا زیرخط باشد').optional(),
});

const BCRYPT_COST = 12;

/* ── login rate limiting (brute-force / credential stuffing) ──────────────
   In-process fixed-window limiter keyed by IP+email: no new dependency, and
   each bucket is cheap (a Map entry with a timestamp). Deliberately generic
   on failure — the 429 message says nothing about accounts. */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginLimiter(key: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= LOGIN_MAX_ATTEMPTS;
}

/* housekeeping so the Map cannot grow unbounded */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginAttempts) if (v.resetAt <= now) loginAttempts.delete(k);
}, 60 * 1000).unref();

function signToken(user: { _id: unknown; email: string; tokenVersion: number }) {
  /* `jti` (unique token id) + `ver` (tokenVersion): the middleware rejects
     tokens whose ver no longer matches the user record, so logout and
     password change invalidate the session on the SERVER, not just client. */
  return jwt.sign(
    { sub: String(user._id), email: user.email, ver: user.tokenVersion, jti: randomUUID() },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn, algorithm: 'HS256' } as jwt.SignOptions,
  );
}

function publicUser(user: { _id: unknown; name: string; email: string; createdAt: Date; lastLoginAt?: Date | null; avatar?: string | null; username?: string | null }) {
  /* NEVER include passwordHash (or any credential material) in a response */
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar ?? null,
    username: user.username ?? null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body);
    /* normalize BEFORE every lookup/write — see normalizeEmail above */
  data.email = normalizeEmail(data.email);
  if (data.username) {
      const taken = await User.findOne({ username: data.username });
      if (taken) throw new ApiError(409, 'این آیدی قبلاً گرفته شده است.');
    }
    const exists = await User.findOne({ email: data.email });
    if (exists) throw new ApiError(409, 'با این ایمیل قبلاً حساب ساخته شده است.');
    try {
      const user = await User.create({
        name: data.name,
        email: data.email,
        passwordHash: await bcrypt.hash(data.password, BCRYPT_COST),
        tokenVersion: 0,
        lastLoginAt: new Date(),
        ...(data.username ? { username: data.username } : {}),
      });
      await Settings.create({ userId: user._id });
      res.status(201).json({ token: signToken(user), user: publicUser(user) });
    } catch (err) {
      /* the unique index is the real duplicate guard — the pre-check above
         can race; map the index error to the same friendly 409 */
      if ((err as { code?: number })?.code === 11000) {
        throw new ApiError(409, 'این ایمیل یا آیدی قبلاً استفاده شده است.');
      }
      throw err;
    }
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        email: z.string().email('ایمیل معتبر نیست').max(200),
        password: z.string().min(1, 'رمز عبور را وارد کنید').max(128),
      })
      .parse(req.body);

    const limiterKey = `${req.ip ?? 'unknown'}|${data.email.toLowerCase()}`;
    if (!loginLimiter(limiterKey)) {
      throw new ApiError(429, 'تلاش‌های ناموفق زیاد بوده است. لطفاً کمی بعد دوباره تلاش کنید.');
    }

    /* the SAME normalization the register path applied — a credentials
       match must never depend on letter case or stray whitespace */
    data.email = normalizeEmail(data.email);
    const user = await User.findOne({ email: data.email });
    /* ONE generic failure for «no such user» AND «wrong password» — the
       error is identical so the endpoint cannot be used to enumerate emails.
       A dummy compare keeps the timing similar for unknown emails. */
    const ok = user
      ? await bcrypt.compare(data.password, user.passwordHash)
      : await bcrypt.compare(data.password, '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7VTgxjrpU8k95Lxvtqk1PGCvXnLBDF6');
    if (!user || !ok) {
      throw new ApiError(401, 'ایمیل یا رمز عبور اشتباه است.');
    }

    /* a SUCCESSFUL login clears the bucket — only failed attempts count
       toward the brute-force cap, or heavy legit use gets locked out */
    loginAttempts.delete(limiterKey);

    user.lastLoginAt = new Date();
    await user.save();
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const user = await User.findById(req.user!.id).select('name email avatar username createdAt lastLoginAt');
    if (!user) throw new ApiError(401, 'برای ادامه باید وارد حساب خود شوید.');
    res.json({ user: publicUser(user) });
  })
);

router.put(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = z
      .object({
        name: z.string().min(2).max(80).optional(),
        currentPassword: z.string().max(128).optional(),
        password: z.string().min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد').max(128).optional(),
        /* small self-contained avatar: a data-URL the client renders directly.
           Server-enforced type + size (a 150 KB cap keeps documents and the
           User record small — avatars are never raw uploads). */
        avatar: z
          .string()
          .regex(/^data:image\/(png|jpeg|webp);base64,/, 'قالب تصویر پشتیبانی نمی‌شود')
          .refine((v) => Buffer.byteLength(v, 'utf8') <= 150 * 1024, 'حجم تصویر باید کمتر از ۱۵۰ کیلوبایت باشد')
          .nullable()
          .optional(),
        /* آیدی کاربر — set once here, changeable later while staying unique */
        username: z.string().regex(USERNAME_RE, 'آیدی باید ۳ تا ۲۴ کاراکتر لاتین، رقم، خط تیره یا زیرخط باشد').nullable().optional(),
      })
      .refine((d) => !(d.password && !d.currentPassword), {
        message: 'برای تغییر رمز، رمز فعلی را وارد کنید',
        path: ['currentPassword'],
      })
      .parse(req.body);
    const user = await User.findById(req.user!.id);
    if (!user) throw new ApiError(401, 'برای ادامه باید وارد حساب خود شوید.');
    if (data.name) user.name = data.name;
    if (data.avatar !== undefined) user.avatar = data.avatar;
    if (data.username !== undefined) {
      if (data.username === null) {
        user.username = null;
      } else {
        const taken = await User.findOne({ username: data.username, _id: { $ne: user._id } });
        if (taken) throw new ApiError(409, 'این آیدی قبلاً گرفته شده است.');
        user.username = data.username;
      }
    }
    let passwordChanged = false;
    if (data.password) {
      /* changing the password requires proving the current one */
      const okCurrent = await bcrypt.compare(data.currentPassword!, user.passwordHash);
      if (!okCurrent) throw new ApiError(403, 'رمز فعلی اشتباه است.');
      user.passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);
      /* every OTHER session dies — the attacker (or an old stolen token)
         cannot keep the access the password change was meant to revoke.
         THIS session receives a fresh token below, so the user stays in. */
      user.tokenVersion += 1;
      passwordChanged = true;
    }
    await user.save();
    /* the current session survives a password change with a fresh token;
       every older token (other devices) is dead via the version bump */
    res.json({ user: publicUser(user), ...(passwordChanged ? { token: signToken(user) } : {}) });
  })
);

/* ── logout: server-side session invalidation ────────────────────────────
   Bearer JWTs are stateless, so «logout» without a bump only clears the
   client copy while the token itself stays valid for 7 days. Bumping
   tokenVersion makes every previously issued token dead immediately. */
router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    await User.updateOne({ _id: req.user!.id }, { $inc: { tokenVersion: 1 } });
    res.json({ ok: true });
  })
);

export default router;
