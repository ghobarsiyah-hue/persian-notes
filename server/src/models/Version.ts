import mongoose, { Schema, model, Document, Types } from 'mongoose';

export interface IVersion extends Document {
  noteId: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  content: object;
  html: string;
  reason: string;
  wordCount: number;
  createdAt: Date;
}

const VersionSchema = new Schema<IVersion>(
  {
    noteId: { type: Schema.Types.ObjectId, ref: 'Note', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    content: { type: Schema.Types.Mixed, required: true },
    html: { type: String, default: '' },
    reason: { type: String, default: 'ذخیره خودکار نسخه' },
    wordCount: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// keep only the latest versions per note — trimmed by the versions service
VersionSchema.index({ noteId: 1, createdAt: -1 });

export const Version = model<IVersion>('Version', VersionSchema);

export const MAX_VERSIONS_PER_NOTE = 50;
