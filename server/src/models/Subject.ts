import mongoose, { Schema, model, Document, Types } from 'mongoose';

export interface ISubject extends Document {
  userId: Types.ObjectId;
  name: string;
  color: string;
  /** optional parent subject for Subject → Chapter → Section hierarchy */
  parentId: Types.ObjectId | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const SubjectSchema = new Schema<ISubject>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, default: '#2563eb' },
    parentId: { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Subject = model<ISubject>('Subject', SubjectSchema);
