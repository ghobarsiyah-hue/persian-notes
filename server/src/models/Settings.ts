import mongoose, { Schema, model, Document, Types } from 'mongoose';

export interface ISettings extends Document {
  userId: Types.ObjectId;
  theme: 'light' | 'dark' | 'system';
  editor: {
    fontSize: number;
    lineHeight: number;
    fontFamily: string;
    /** کادرهای آموزشی customization — legacy string or full object */
    eduBlocks?: Record<string, unknown> | string;
  };
  export: {
    pageSize: 'A4';
    margin: number;
    fontSize: number;
    lineHeight: number;
    showPageNumbers: boolean;
    showHeader: boolean;
    showFooter: boolean;
    headerText: string;
    footerText: string;
    showCover: boolean;
  };
  ai: {
    autoVersionBeforeAI: boolean;
  };
  /** اعلان‌ها — account-level preferences (this doc is per-user) + where the
   *  in-app toast layer renders. Channels that do not exist yet (email /
   *  browser push) are deliberately NOT modelled — no fake switches. */
  notifications: {
    position: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
    prefs: {
      collabJoined: boolean;
      collabEdited: boolean;
      collabLeft: boolean;
      docMajorChange: boolean;
      docShare: boolean;
      docAccessChange: boolean;
      systemSave: boolean;
      systemError: boolean;
      systemWarning: boolean;
      systemUpdate: boolean;
    };
  };
  /** ظاهر و تجربه — the chosen fallback-avatar preset. Users who have not
   *  uploaded a picture get one of the deterministic bot profiles; this
   *  lets THEM pick which one instead of living with the name-hash pick.
   *  'auto' = the legacy name-hash behaviour. */
  avatarPreset: string;
  border: {
    enabled: boolean;
    style: 'classic' | 'double' | 'ornate' | 'minimal' | 'none';
    primaryColor: string;
    secondaryColor: string;
    thickness: number;
    cornerDecoration: boolean;
    showHeader: boolean;
    showFooter: boolean;
    showPageNumbers: boolean;
    sideLabel: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const SettingsSchema = new Schema<ISettings>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    editor: {
      type: new Schema(
        {
          fontSize: { type: Number, default: 16 },
          lineHeight: { type: Number, default: 2 },
          fontFamily: { type: String, default: 'Vazirmatn' },
          /** کادرهای آموزشی customization — stored as a mixed sub-doc so
              the client owns the shape (and old string values keep loading) */
          eduBlocks: { type: Schema.Types.Mixed, default: undefined },
        },
        { _id: false }
      ),
      default: () => ({}),
    },        export: {
          type: new Schema(
            {
              pageSize: { type: String, default: 'A4' },
              margin: { type: Number, default: 20 },
              fontSize: { type: Number, default: 13 },
              lineHeight: { type: Number, default: 1.9 },
              showPageNumbers: { type: Boolean, default: true },
              showHeader: { type: Boolean, default: true },
              showFooter: { type: Boolean, default: true },
              headerText: { type: String, default: '' },
              footerText: { type: String, default: '' },
              showCover: { type: Boolean, default: false },
            },
            { _id: false }
          ),
          default: () => ({}),
        },
    ai: {
      type: new Schema({ autoVersionBeforeAI: { type: Boolean, default: true } }, { _id: false }),
      default: () => ({}),
    },
    notifications: {
      type: new Schema(
        {
          position: {
            type: String,
            enum: ['top-right', 'top-left', 'bottom-right', 'bottom-left'],
            default: 'bottom-left',
          },
          prefs: {
            type: new Schema(
              {
                collabJoined: { type: Boolean, default: true },
                collabEdited: { type: Boolean, default: false },
                collabLeft: { type: Boolean, default: false },
                docMajorChange: { type: Boolean, default: true },
                docShare: { type: Boolean, default: true },
                docAccessChange: { type: Boolean, default: true },
                systemSave: { type: Boolean, default: false },
                systemError: { type: Boolean, default: true },
                systemWarning: { type: Boolean, default: true },
                systemUpdate: { type: Boolean, default: true },
              },
              { _id: false }
            ),
            default: () => ({}),
          },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    border: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: true },
          style: { type: String, enum: ['classic', 'double', 'ornate', 'minimal', 'none'], default: 'classic' },
          primaryColor: { type: String, default: '#1e3a5f' },
          secondaryColor: { type: String, default: '#c5a24d' },
          thickness: { type: Number, default: 1 },
          cornerDecoration: { type: Boolean, default: true },
          showHeader: { type: Boolean, default: true },
          showFooter: { type: Boolean, default: true },
          showPageNumbers: { type: Boolean, default: true },
          sideLabel: { type: String, default: '' },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    avatarPreset: { type: String, default: 'auto', maxlength: 40 },
  },
  { timestamps: true }
);

export const Settings = model<ISettings>('Settings', SettingsSchema);
