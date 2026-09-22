import mongoose, { Schema, model, Document, Types } from 'mongoose';

export interface ITemplate extends Document {
  /** built-in templates have a stable key and no user owner */
  key?: string;
  userId?: Types.ObjectId | null;
  name: string;
  description: string;
  category: string;
  /** typography & layout settings applied by the template */
  style: {
    fontFamily?: string;
    fontSize?: number;
    lineHeight?: number;
    headingScale?: number;
    pageMargin?: number;
    accentColor?: string;
  };
  /** initial TipTap JSON content */
  content: object;
  /** starter HTML for the editor */
  html?: string;
  /** user-created templates are flagged; built-in templates live in seed */
  isUserTemplate: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TemplateSchema = new Schema<ITemplate>(
  {
    key: { type: String, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, default: 'عمومی' },
    style: {
      type: new Schema(
        {
          fontFamily: String,
          fontSize: Number,
          lineHeight: Number,
          headingScale: Number,
          pageMargin: Number,
          accentColor: String,
        },
        { _id: false }
      ),
      default: {},
    },
    content: { type: Schema.Types.Mixed, required: true },
    html: { type: String, default: '' },
    isUserTemplate: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Template = model<ITemplate>('Template', TemplateSchema);
