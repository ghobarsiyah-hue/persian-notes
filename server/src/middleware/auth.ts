import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';

export interface AuthRequest extends Request {
  user?: { id: string; email: string };
}

/* The token payload — `ver` carries the user's tokenVersion so sessions can
 * be invalidated server-side (logout / password change bumps it). */
interface TokenPayload {
  sub: string;
  email: string;
  ver: number;
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    /* algorithm is PINNED: without it, a token forged as alg:none or a
     * public-key confusion variant could pass jwt.verify */
    const payload = jwt.verify(token, env.jwtSecret, {
      algorithms: ['HS256'],
    }) as TokenPayload;
    if (typeof payload.sub !== 'string' || typeof payload.ver !== 'number') return null;
    return payload;
  } catch {
    return null;
  }
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    /* one uniform message for every auth failure — no signal about WHY */
    return res.status(401).json({ error: 'برای ادامه باید وارد حساب خود شوید.' });
  }
  const payload = verifyToken(header.slice(7));
  if (!payload) {
    return res.status(401).json({ error: 'برای ادامه باید وارد حساب خود شوید.' });
  }
  try {
    const user = await User.findById(payload.sub);
    if (!user || user.tokenVersion !== payload.ver) {
      /* unknown user OR a token issued before a logout/password change —
         same generic message, session is truly dead */
      return res.status(401).json({ error: 'برای ادامه باید وارد حساب خود شوید.' });
    }
    req.user = { id: String(user._id), email: user.email };
    next();
  } catch {
    return res.status(401).json({ error: 'برای ادامه باید وارد حساب خود شوید.' });
  }
}
