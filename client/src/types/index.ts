export type { Group, GroupMember, GroupRole, GroupMembershipStatus } from './group';
export { GROUP_ROLE_LABELS, GROUP_ROLE_LABELS_PLURAL, JOIN_POLICY_LABELS, CONTENT_POLICY_LABELS } from './group';

export interface User {
  id: string;
  name: string;
  email: string;
  /** small data-URL image (≤150 KB) — null = initials fallback */
  avatar?: string | null;
  /** public user ID (آیدی) — latin handle shown instead of/next to email */
  username?: string | null;
  createdAt?: string;
  lastLoginAt?: string | null;
}

/** اعلان‌ها — account-level preferences + in-app toast placement.
 *  Channels without real infrastructure (email/push) are intentionally
 *  absent — the UI must never promise a capability the system lacks. */
export type NotificationPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export interface NotificationPrefs {
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
}

export interface NotificationsSettings {
  position: NotificationPosition;
  prefs: NotificationPrefs;
}

export interface Subject {
  _id: string;
  name: string;
  color: string;
  parentId: string | null;
  order: number;
}

export interface Tag {
  _id: string;
  name: string;
  color: string;
}

export interface Note {
  _id: string;
  /** when set, this is a گروهی (group-shared) note — editor allows any
   *  active member to read; creator/group-admin to edit (server-verified) */
  groupId?: string | null;
  title: string;
  subjectId: Subject | null | string;
  chapter: string;
  section: string;
  content: Record<string, unknown>;
  html: string;
  plainText: string;
  tags: Tag[] | string[];
  favorite: boolean;
  trashed: boolean;
  trashedAt?: string | null;
  wordCount: number;
  metadata?: { seed?: boolean; templateId?: string | null } & Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** server-assigned monotonic revision — used for optimistic-concurrency
   *  conflict detection on collaborative saves; optional until the server
   *  round-trips it everywhere */
  revision?: number;
}

export interface Template {
  _id: string;
  key?: string;
  name: string;
  description: string;
  category: string;
  style: {
    fontSize?: number;
    lineHeight?: number;
    pageMargin?: number;
    accentColor?: string;
  };
  content: Record<string, unknown>;
  isBuiltIn: boolean;
}

export interface VersionSummary {
  _id: string;
  title: string;
  reason: string;
  wordCount: number;
  createdAt: string;
}

export type BorderStyle = 'classic' | 'double' | 'ornate' | 'minimal' | 'none';

/** Customization of the educational (کادر آموزشی) blocks.
 *  Persisted per-user in settings.editor.eduBlocks; legacy notes may still
 *  carry the old 'minimal' | 'tinted' string (migrated at load). */
export interface EduBlocksSettings {
  /** minimal = crisp border, no fill; tinted/strong = colored fill boxes */
  base: 'minimal' | 'tinted' | 'strong';
  /** border color of every box ('' = shipped default) */
  borderColor: string;
  /** border width in px (0 → hairline shadow instead) */
  borderWidth: number;
  /** border line pattern */
  borderStyle: 'solid' | 'dashed' | 'dotted';
  /** corner radius in px */
  radius: number;
  /** inner padding in px (0 = shipped 0.6em/0.9em default) */
  padding: number;
  /** box shadow */
  shadow: 'none' | 'soft' | 'raised';
  /** colored accent bar on one edge (start = راست in RTL) */
  accentBar: 'none' | 'start' | 'end';
  /** title treatment: plain / neutral wash / family-colored bar */
  titleBar: 'none' | 'soft' | 'full';
  /** title font-weight (400–800) */
  titleWeight: number;
  /** title font-size as % of body (60–140) */
  titleSize: number;
  /** master switch for the premium icons in titles */
  iconsVisible: boolean;
  /** fill strength for the tinted base */
  tint: 'none' | 'soft' | 'strong';
  /** per-family fill overrides — edu family → hex */
  fillColors: Partial<Record<string, string>>;
  /** per-family title-color overrides — edu family → hex */
  titleColors: Partial<Record<string, string>>;
  /** per-family accent-bar color overrides (falls back to title color) */
  accentColors: Partial<Record<string, string>>;
  /** per-family icon visibility overrides */
  hideIcons: Partial<Record<string, boolean>>;
}

/** Visual kind of an editor page:
 *  framed   — A4 sheet with the ornamental border (پیش‌فرض)
 *  blank    — clean white sheet without any frame (صفحه بلنک، بدون قاب)
 *  notebook — ruled notebook-style sheet (صفحه نوت‌بوکی، خط‌دار)
 *  cover    — full-bleed image page (جلد اول/دوم/آخر — عکس + عنوان اختیاری)
 *  toc      — فهرست مطالب: عنوان‌بندی سند به‌صورت خودکار (auto-filled at print)
 *  booklet  — خیلی سبز: قاب دولایهٔ ظریف + flourish + شماره صفحه + waveform + باکس لوگو */
export type PageKind = 'framed' | 'blank' | 'notebook' | 'cover' | 'toc' | 'booklet';

/** kind of cover page — which position it decorates (item 15) */
export type CoverSlot = 'first' | 'second' | 'last';

/** data carried by a cover page: the uploaded artwork + optional caption */
export interface CoverData {
  slot: CoverSlot;
  /** data-URL of the uploaded image (auto-fitted by loadImageFile) */
  src?: string;
  /** cover fit inside the sheet */
  fit?: 'cover' | 'contain';
  title?: string;
  subtitle?: string;
}

/** cover metadata stored ON THE PAGE's coverData attr (mergePagesIntoDoc
 *  persists it on the pageBreak; splitDocIntoPages reads it back) */
export interface PageCoverAttrs extends Record<string, unknown> {
  slot?: CoverSlot;
  coverSrc?: string;
  coverFit?: 'cover' | 'contain';
  coverTitle?: string;
  coverSubtitle?: string;
}

export interface BorderSettings {
  enabled: boolean;
  style: BorderStyle;
  primaryColor: string;
  secondaryColor: string;
  /** color of the tinted band between the wavy lines (the ice-blue); 'none' removes it */
  fillColor?: string;
  thickness: number;
  cornerDecoration: boolean;
  showHeader: boolean;
  showFooter: boolean;
  showPageNumbers: boolean;
  /** vertical label on the left edge of the frame (empty = default) */
  sideLabel: string;
  /** lesson/chapter label in the top-left header slot of the frame
   *  (item 16 — empty = no notch, the top edge stays continuous) */
  headerLabel?: string;
}

export const DEFAULT_BORDER_SETTINGS: BorderSettings = {
  enabled: true,
  style: 'classic',
  primaryColor: '#1e3a5f',
  secondaryColor: '#c5a24d',
  fillColor: '#b8d8e8',
  thickness: 1,
  cornerDecoration: true,
  showHeader: true,
  showFooter: true,
  showPageNumbers: true,
  sideLabel: 'پزشکی بهمن ۱۴۰۴',
};

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  editor: {
    fontSize: number;
    lineHeight: number;
    fontFamily: string;
    /** visual style of the educational (کادر آموزشی) blocks —
     *  legacy string form ('minimal' | 'tinted') or the full customization */
    eduBlocks?: EduBlocksSettings | 'minimal' | 'tinted';
  };
  export: {
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
  ai: { autoVersionBeforeAI: boolean };
  border: BorderSettings;
  notifications: NotificationsSettings;
  /** fallback-avatar preset — 'auto' (name-hash) or a chosen bot profile id;
   *  only applies while no custom picture is uploaded */
  avatarPreset: string;
}

export type AIActionId =
  | 'proofread'
  | 'professionalize'
  | 'summarize'
  | 'simplify'
  | 'key_points'
  | 'exam_points'
  | 'questions'
  | 'flashcards'
  | 'table'
  | 'continue'
  | 'structure';

export interface AIActionInfo {
  id: AIActionId;
  label: string;
  available: boolean;
}

export interface AIStatus {
  provider: string;
  actions: AIActionInfo[];
}

export interface AIResult {
  action: AIActionId;
  output: string;
  provider: string;
  detail?: string;
}

export interface SearchHit {
  note: Note;
  snippet: { text: string; matchStart: number; matchEnd: number } | null;
  titleMatch: boolean;
  matchedIn: string[];
}

/**
 * Centralized save-state machine (single source of truth for every save
 * indicator in the app):
 *
 *   idle       — nothing loaded/unchanged since load
 *   dirty      — unsaved edits exist, debounce timer armed
 *   saving     — a PUT is in flight
 *   saved      — server confirms the newest revision
 *   offline    — save failed because the network is down; edits are kept in
 *                the per-user pending store (pn_pending_u-*)
 *   pendingSync— back online, queued edits waiting to be flushed
 *   failed     — save rejected (conflict/permission); recoverable via retry
 *
 * UI must render THIS union only (see components SaveStatusBadge). No
 * component may invent its own ad-hoc status strings anymore.
 */
export type SaveState =
  | 'idle'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'pendingSync'
  | 'failed';

/** Shape of a note's locally-queued (offline) edit — the payload plus the
 *  revision the client based it on and the wall-clock time it was queued. */
export interface PendingNoteSave {
  noteId: string;
  baseRevision: number;
  updatedAt: string;
  payload: Record<string, unknown>;
}

/** Persistent user notification (server-backed inbox row) — keep DISTINCT
 *  from the transient Toast UI (AppProvider Toast). Autosave success must
 *  become a save-indicator transition, never a persistent notification. */
export type NotificationSeverity = 'success' | 'info' | 'warning' | 'error';

export interface AppNotification {
  _id: string;
  userId: string;
  /** 'system:*' today; future group/club/share/mention events add values
   *  without a schema migration */
  type: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  read: boolean;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface OutlineItem {
  id: string;
  level: number;
  text: string;
}

export interface DocumentOutline {
  items: OutlineItem[];
  wordCount: number;
  charCount: number;
  blockCount: number;
  pageEstimate: number;
}
