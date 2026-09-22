import mongoose, { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  /** bumped on logout / password change — tokens with an older value are
   *  rejected by requireAuth, so a logout invalidates the session SERVER-side
   *  (a stolen bearer token cannot outlive the user's own logout). */
  tokenVersion: number;
  lastLoginAt?: Date | null;
  /** small data-URL image (≤150 KB, image/*) — validated at the API layer;
   *  null = no custom avatar (the UI falls back to name initials) */
  avatar?: string | null;
  /** public user ID (آیدی) — optional handle, latin/digits/_/- only.
   *  NOT a login credential (login stays email-based); unique + sparse so
   *  existing users without one keep loading. */
  username?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    tokenVersion: { type: Number, required: true, default: 0 },
    lastLoginAt: { type: Date, default: null },
    avatar: { type: String, default: null },
    username: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
      /* NOT `unique: true, sparse: true` here — a sparse index still INDEXES
       * explicit `null` values (sparse only skips MISSING fields), so the
       * second registered user's `username: null` hit E11000 on username_1
       * and EVERY later registration failed with «قبلاً استفاده شده است».
       * The unique constraint lives in the partial index below, which only
       * indexes documents where username is an actual string. */
      match: [/^[a-z0-9_-]{3,24}$/, 'آیدی نامعتبر است'],
    },
  },
  { timestamps: true }
);

/* unique ONLY among real handles (nulls excluded — see the field comment):
 * partialFilterExpression $type:string is the MongoDB-documented pattern
 * for «unique when present» that survives explicit null defaults. */
UserSchema.index(
  { username: 1 },
  { unique: true, partialFilterExpression: { username: { $type: 'string' } } }
);

export const User = model<IUser>('User', UserSchema);
