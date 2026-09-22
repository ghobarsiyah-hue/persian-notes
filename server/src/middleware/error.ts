import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { RevisionConflictError } from '../routes/notes.js';

/** MongoDB/BSON errors thrown for malformed ObjectId-like values.
    Duck-typed: mongoose 8 exports CastError as a type only, so instanceof
    is unavailable — name/message checks cover it reliably. */
function isBsonCastError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  if (!e) return false;
  if (e.name === 'CastError' || e.name === 'BSONError') return true;
  // e.g. "Invalid id ..." / "input must be a 24 character hex string"
  return typeof e.message === 'string' && /invalid (id|objectid|hex)|24 character hex/i.test(e.message);
}

/** Express body-parser error for malformed JSON payloads */
function isJsonParseError(err: unknown): boolean {
  return (err as { type?: string } | null)?.type === 'entity.parse.failed';
}

export class ApiError extends Error {
  status: number;
  /** machine-readable extras carried into the JSON body (e.g. the server's
   *  current `revision` on a 409 — clients need it to reconcile + retry) */
  meta?: Record<string, unknown>;
  constructor(status: number, message: string, meta?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.meta = meta;
  }
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'مسیر درخواستی یافت نشد.' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const msg = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' — ');
    return res.status(400).json({ error: `داده‌های ورودی نامعتبر است: ${msg}` });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, ...(err.meta ?? {}) });
  }
  /* stale out-of-order save: respond with the note's CURRENT revision so the
     client can re-read and re-apply its pending changes on the fresh base */
  if (err instanceof RevisionConflictError) {
    return res.status(409).json({ error: 'این یادداشت در جای دیگری تغییر کرده است.', code: 'revision_conflict' });
  }
  if ((err as { name?: string })?.name === 'ValidationError') {
    return res.status(400).json({ error: 'داده‌های ورودی نامعتبر است.' });
  }
  if ((err as { code?: number })?.code === 11000) {
    return res.status(409).json({ error: 'این مورد از قبل وجود دارد.' });
  }
  // malformed :id / ObjectId-shaped params and query strings → client error, not 500
  if (isBsonCastError(err)) {
    return res.status(400).json({ error: 'شناسه وارد شده نامعتبر است.' });
  }
  // malformed request body (bad JSON from client) → client error, not 500
  if (isJsonParseError(err)) {
    return res.status(400).json({ error: 'بدنه درخواست JSON معتبر نیست.' });
  }
  console.error('✗ خطای سرور:', err);
  res.status(500).json({ error: 'خطای داخلی سرور. لطفاً دوباره تلاش کنید.' });
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
