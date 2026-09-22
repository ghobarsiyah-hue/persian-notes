import mongoose, { Schema, model, Document, Types } from 'mongoose';

export interface ITag extends Document {
  userId: Types.ObjectId;
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

const TagSchema = new Schema<ITag>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, unique: false },
    color: { type: String, default: '#0ea5e9' },
  },
  { timestamps: true }
);

TagSchema.index({ userId: 1, name: 1 }, { unique: true });

export const Tag = model<ITag>('Tag', TagSchema);
