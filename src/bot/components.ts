/**
 * Discord Components v2 builder helpers.
 *
 * Components v2 replaces embeds with a structured component tree.
 * Every message using these must include flags: MessageFlags.IsComponentsV2 (1 << 15 = 32768).
 *
 * Type references:
 *   1  = ActionRow
 *   2  = Button
 *   3  = StringSelect
 *   9  = Section
 *   10 = TextDisplay
 *   14 = Separator
 *   17 = Container
 *
 * Button styles: 1=Primary 2=Secondary 3=Success 4=Danger 5=Link
 */

// ---------------------------------------------------------------------------
// Raw component shape types
// ---------------------------------------------------------------------------

export interface TextDisplay {
  type: 10;
  content: string;
  id?: number;
}

export interface Separator {
  type: 14;
  divider?: boolean;
  spacing?: 1 | 2; // 1=small, 2=large
  id?: number;
}

export interface Button {
  type: 2;
  style: 1 | 2 | 3 | 4 | 5;
  label?: string;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
  emoji?: { name: string; id?: string; animated?: boolean };
  id?: number;
}

export interface ActionRow {
  type: 1;
  components: Button[];
  id?: number;
}

export interface Thumbnail {
  type: 11;
  media: { url: string };
  description?: string;
  id?: number;
}

export interface Section {
  type: 9;
  components: TextDisplay[];
  accessory?: Button | Thumbnail;
  id?: number;
}

export interface Container {
  type: 17;
  components: (TextDisplay | Separator | Section | ActionRow)[];
  accent_color?: number; // decimal RGB integer
  spoiler?: boolean;
  id?: number;
}

export type AnyComponent = TextDisplay | Separator | Button | ActionRow | Section | Container | Thumbnail;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

let _id = 1;
function nextId() { return _id++; }

export function resetIds() { _id = 1; }

export function text(content: string): TextDisplay {
  return { type: 10, content, id: nextId() };
}

export function sep(divider = false, spacing: 1 | 2 = 1): Separator {
  return { type: 14, divider, spacing, id: nextId() };
}

export function row(...buttons: Button[]): ActionRow {
  return { type: 1, components: buttons, id: nextId() };
}

export function btn(
  label: string,
  style: Button["style"],
  opts: { customId?: string; url?: string; disabled?: boolean; emoji?: Button["emoji"] } = {},
): Button {
  const b: Button = { type: 2, style, label, id: nextId() };
  if (opts.customId) b.custom_id = opts.customId;
  if (opts.url) b.url = opts.url;
  if (opts.disabled) b.disabled = true;
  if (opts.emoji) b.emoji = opts.emoji;
  return b;
}

/**
 * A Section (type 9) is ONLY valid when it carries an accessory (a Button or
 * Thumbnail on the right). Discord rejects accessory-less sections with
 * "Invalid Form Body". This helper therefore requires an accessory.
 *
 * For text that has no accessory, push the `text(...)` components straight into
 * the container instead of wrapping them in a section.
 */
export function section(components: TextDisplay[], accessory: Button | Thumbnail): Section {
  return { type: 9, components, accessory, id: nextId() };
}

/**
 * Build a section when an accessory is available, otherwise return the plain
 * text components so the caller can spread them directly into a container.
 * This keeps avatar-optional layouts valid whether or not an image exists.
 */
export function sectionOrText(
  components: TextDisplay[],
  accessory?: Button | Thumbnail,
): Section | TextDisplay[] {
  return accessory ? section(components, accessory) : components;
}

export function container(
  components: (TextDisplay | Separator | Section | ActionRow)[],
  accentColor?: number,
): Container {
  return { type: 17, components, accent_color: accentColor, id: nextId() };
}

export function thumbnail(url: string, description?: string): Thumbnail {
  return { type: 11, media: { url }, description, id: nextId() };
}

// ---------------------------------------------------------------------------
// Color constants (decimal RGB)
// ---------------------------------------------------------------------------

export const COLOR = {
  primary: 0x5865f2,   // Discord blurple
  success: 0x57f287,   // green
  warning: 0xfee75c,   // yellow
  danger: 0xed4245,    // red
  info: 0x5865f2,      // blurple
  muted: 0x2b2d31,     // dark
  white: 0xffffff,
  orange: 0xe67e22,
  purple: 0x9b59b6,
} as const;

// ---------------------------------------------------------------------------
// Priority colors
// ---------------------------------------------------------------------------

export const PRIORITY_COLOR: Record<string, number> = {
  low: COLOR.muted,
  normal: COLOR.info,
  high: COLOR.warning,
  urgent: COLOR.danger,
};

// ---------------------------------------------------------------------------
// Status badge text
// ---------------------------------------------------------------------------

export function statusBadge(status: string): string {
  const map: Record<string, string> = {
    open: "🟢 Open",
    in_progress: "🔵 In Progress",
    closed: "⚫ Closed",
    active: "✅ Active",
    pending: "⏳ Pending",
    expired: "🔴 Expired",
    canceled: "⚪ Canceled",
    waiting: "⏳ Waiting",
    paid: "✅ Paid",
    failed: "❌ Failed",
    confirming: "🔄 Confirming",
  };
  return map[status] ?? status;
}

export function priorityBadge(priority: string): string {
  const map: Record<string, string> = {
    low: "⬇️ Low",
    normal: "➡️ Normal",
    high: "⬆️ High",
    urgent: "🚨 Urgent",
  };
  return map[priority] ?? priority;
}

// ---------------------------------------------------------------------------
// Complete message payload builders
// ---------------------------------------------------------------------------

/** Wrap components into a IS_COMPONENTS_V2 message payload */
export function cv2Message(components: AnyComponent[], ephemeral = true) {
  return {
    flags: 32768 | (ephemeral ? 64 : 0), // IsComponentsV2 | Ephemeral
    components,
  };
}

/** Simple info message */
export function infoMessage(title: string, body: string, ephemeral = true) {
  resetIds();
  return cv2Message(
    [
      container(
        [
          text(`## ${title}`),
          sep(false),
          text(body),
        ],
        COLOR.info,
      ),
    ],
    ephemeral,
  );
}

/** Success message */
export function successMessage(title: string, body: string) {
  resetIds();
  return cv2Message(
    [
      container(
        [
          text(`## ${title}`),
          sep(false),
          text(body),
        ],
        COLOR.success,
      ),
    ],
    true,
  );
}

/** Error message */
export function errorMessage(body: string) {
  resetIds();
  return cv2Message(
    [
      container(
        [
          text(`## Error`),
          sep(false),
          text(body),
        ],
        COLOR.danger,
      ),
    ],
    true,
  );
}
