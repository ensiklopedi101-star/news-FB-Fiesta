/**
 * Publishing runs on fixed clock slots in WITA (Waktu Indonesia Tengah,
 * UTC+8, no DST). The cron endpoint is still called every 15 minutes; it only
 * publishes when the current WITA time falls inside a slot window.
 *
 * 16 slots by default, all at least 30 minutes apart so they never collide with
 * the 12-minute minimum gap enforced by the pipeline.
 */
export const WITA_OFFSET_MINUTES = 8 * 60;
export const MINUTES_PER_DAY = 24 * 60;
export const DEFAULT_SLOT_GRACE_MINUTES = 14;

export const DEFAULT_SLOTS_WITA = [
  "06:45",
  "07:45",
  "08:45",
  "09:45",
  "10:45",
  "11:45",
  "13:15",
  "14:15",
  "16:15",
  "17:15",
  "18:15",
  "19:15",
  "20:15",
  "20:45",
  "21:15",
  "21:45",
] as const;

/** Parses `HH:MM` (or `H.MM`) into minutes after midnight; returns null when invalid. */
export function timeToMinutes(value: string): number | null {
  const match = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatMinutes(minutes: number): string {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

const DEFAULT_SLOT_MINUTES = DEFAULT_SLOTS_WITA.map((slot) => {
  const minutes = timeToMinutes(slot);
  if (minutes === null) throw new Error(`Slot jadwal default tidak valid: ${slot}`);
  return minutes;
});

export type SlotConfig = {
  /** Sorted, unique minutes after midnight (WITA). */
  slots: number[];
  /** A slot stays publishable for this many minutes after its clock time. */
  graceMinutes: number;
  /** `PUBLISH_SLOTS_WITA=off` publishes whenever the cron runs, like before. */
  disabled: boolean;
};

/**
 * `PUBLISH_SLOTS_WITA` accepts a comma separated list (`"08:00, 12:30"`) or
 * `off`. Empty means the built-in 16-slot schedule.
 * `PUBLISH_SLOT_GRACE_MINUTES` defaults to 14 minutes, matching the 15-minute cron.
 */
export function loadSlotConfig(env: Record<string, string | undefined> = process.env): SlotConfig {
  const rawSlots = env.PUBLISH_SLOTS_WITA?.trim();
  const rawGrace = Number(env.PUBLISH_SLOT_GRACE_MINUTES?.trim());
  const graceMinutes = Number.isFinite(rawGrace) && rawGrace >= 1
    ? Math.min(Math.round(rawGrace), 59)
    : DEFAULT_SLOT_GRACE_MINUTES;

  if (rawSlots && rawSlots.toLowerCase() === "off") return { slots: [], graceMinutes, disabled: true };
  if (!rawSlots) return { slots: [...DEFAULT_SLOT_MINUTES], graceMinutes, disabled: false };

  const parsed = rawSlots
    .split(",")
    .map(timeToMinutes)
    .filter((minutes): minutes is number => minutes !== null);
  if (!parsed.length) return { slots: [...DEFAULT_SLOT_MINUTES], graceMinutes, disabled: false };

  const slots = [...new Set(parsed)].sort((a, b) => a - b);
  return { slots, graceMinutes, disabled: false };
}

/** Minutes after midnight in WITA for any instant. */
export function witaMinutes(date: Date): number {
  const shifted = new Date(date.getTime() + WITA_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** Weekday in WITA: 0 = Sunday … 6 = Saturday. */
export function witaWeekday(date: Date): number {
  return new Date(date.getTime() + WITA_OFFSET_MINUTES * 60_000).getUTCDay();
}

/** Whole days since the Unix epoch in WITA, so day math ignores clock time and time zones. */
export function witaDayNumber(date: Date): number {
  return Math.floor((date.getTime() + WITA_OFFSET_MINUTES * 60_000) / 86_400_000);
}

/** `YYYY-MM-DD` in WITA, handy for logs and dashboards. */
export function witaDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + WITA_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export type SlotState = {
  enabled: boolean;
  /** True when the current instant sits inside a slot window. */
  active: boolean;
  graceMinutes: number;
  slots: string[];
  activeSlot: string | null;
  nextSlot: string | null;
  /** Minutes until `nextSlot` starts; null when the schedule is disabled. */
  minutesUntilNextSlot: number | null;
};

export function slotStateAt(date: Date, config: SlotConfig = loadSlotConfig()): SlotState {
  if (config.disabled || !config.slots.length) {
    return {
      enabled: false,
      active: true,
      graceMinutes: config.graceMinutes,
      slots: [],
      activeSlot: null,
      nextSlot: null,
      minutesUntilNextSlot: null,
    };
  }

  const now = witaMinutes(date);
  const activeSlot = config.slots.find((slot) => now >= slot && now < slot + config.graceMinutes);
  const upcoming = config.slots.find((slot) => slot > now);
  const nextSlotMinutes = upcoming ?? config.slots[0]! + MINUTES_PER_DAY;

  return {
    enabled: true,
    active: activeSlot !== undefined,
    graceMinutes: config.graceMinutes,
    slots: config.slots.map(formatMinutes),
    activeSlot: activeSlot === undefined ? null : formatMinutes(activeSlot),
    nextSlot: formatMinutes(nextSlotMinutes),
    minutesUntilNextSlot: nextSlotMinutes - now,
  };
}
