import mongoose, { Schema, model, Document, Types } from 'mongoose';

export type NotificationSeverity = 'success' | 'info' | 'warning' | 'error';

export interface INotification extends Document {
  userId: Types.ObjectId;
  /** machine-readable kind — 'system:*' today; future group/club/share/
   *  mention events add their own values WITHOUT a schema change (§7) */
  type: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  read: boolean;
  /** optional housekeeping: expired rows are pruned on read, never shown */
  expiresAt?: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true, default: 'system:info' },
    title: { type: String, required: true, maxlength: 200 },
    message: { type: String, default: '', maxlength: 2000 },
    severity: {
      type: String,
      enum: ['success', 'info', 'warning', 'error'],
      default: 'info',
      index: true,
    },
    read: { type: Boolean, default: false, index: true },
    expiresAt: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

/* unread inbox query: newest first, per user */
NotificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', NotificationSchema);
