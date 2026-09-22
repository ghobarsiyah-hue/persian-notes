import mongoose, { Schema, model, Document, Types } from 'mongoose';

export interface INote extends Document {
  userId: Types.ObjectId;
  /** when set, this note belongs to a group (جزوه گروهی): every ACTIVE
   *  member can read it, creator/owner/admin can edit it (server-checked) */
  groupId: Types.ObjectId | null;
  title: string;
  subjectId?: Types.ObjectId | null;
  chapter: string;
  section: string;
  /** TipTap JSON document */
  content: object;
  /** Rendered HTML, refreshed on save (used for export / preview) */
  html: string;
  plainText: string;
  tags: Types.ObjectId[];
  favorite: boolean;
  trashed: boolean;
  trashedAt?: Date | null;
  wordCount: number;
  /** monotonic write counter, bumped on every persisted change — the client
   *  sends the revision it based its edit on and a stale base gets a 409
   *  instead of a silent out-of-order overwrite (persistence layer §4) */
  revision: number;
  /** when true, this note is a user-defined template and can be cloned */
  isTemplate: boolean;
  metadata: {
    pageEstimate?: number;
    templateId?: Types.ObjectId | null;
    [key: string]: unknown;
  };
  createdAt: Date;
  updatedAt: Date;
}

const NoteSchema = new Schema<INote>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', default: null, index: true },
    title: { type: String, required: true, trim: true, default: 'بدون عنوان' },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', default: null, index: true },
    chapter: { type: String, default: '', trim: true },
    section: { type: String, default: '', trim: true },
    content: { type: Schema.Types.Mixed, required: true },
    html: { type: String, default: '' },
    plainText: { type: String, default: '' },
    tags: [{ type: Schema.Types.ObjectId, ref: 'Tag' }],
    favorite: { type: Boolean, default: false, index: true },
    trashed: { type: Boolean, default: false, index: true },
    isTemplate: { type: Boolean, default: false, index: true },
    trashedAt: { type: Date, default: null },
    wordCount: { type: Number, default: 0 },
    revision: { type: Number, default: 0 },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

NoteSchema.index({ title: 'text', plainText: 'text' });

export const Note = model<INote>('Note', NoteSchema);
