import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SLOTS_WITA,
  formatMinutes,
  loadSlotConfig,
  slotStateAt,
  timeToMinutes,
  witaDateKey,
  witaMinutes,
  type SlotConfig,
} from "../src/lib/publish-slots";

/** Builds an instant whose WITA wall clock reads `HH:MM` on 2026-03-10. */
function witaInstant(clock: string, dayOffset = 0): Date {
  const minutes = timeToMinutes(clock);
  assert.notEqual(minutes, null);
  const midnightWita = Date.UTC(2026, 2, 10 + dayOffset, 0, 0, 0);
  return new Date(midnightWita + minutes! * 60_000 - 8 * 60 * 60_000);
}

const config: SlotConfig = { slots: [405, 465, 525], graceMinutes: 14, disabled: false }; // 06:45, 07:45, 08:45

test("default schedule has 16 slots in WITA, sorted and evenly spaced", () => {
  assert.equal(DEFAULT_SLOTS_WITA.length, 16);
  const minutes = DEFAULT_SLOTS_WITA.map(timeToMinutes);
  assert.ok(minutes.every((value) => value !== null));
  assert.deepEqual(minutes, [...minutes].sort((a, b) => a! - b!));
  for (let index = 1; index < minutes.length; index += 1) {
    assert.ok(minutes[index]! - minutes[index - 1]! >= 30, "slot harus berjarak minimal 30 menit");
  }
});

test("WITA is UTC+8 without daylight saving", () => {
  assert.equal(witaMinutes(witaInstant("06:45")), 405);
  assert.equal(witaDateKey(witaInstant("00:15")), "2026-03-10");
  // 17:00 UTC is 01:00 WITA on the next calendar day.
  assert.equal(witaDateKey(new Date("2026-03-10T17:00:00Z")), "2026-03-11");
  assert.equal(witaMinutes(new Date("2026-03-10T17:00:00Z")), 60);
});

test("a slot stays open for exactly the grace window", () => {
  assert.equal(slotStateAt(witaInstant("06:44"), config).active, false);
  assert.equal(slotStateAt(witaInstant("06:45"), config).activeSlot, "06:45");
  assert.equal(slotStateAt(witaInstant("06:58"), config).activeSlot, "06:45");
  assert.equal(slotStateAt(witaInstant("06:59"), config).active, false);
  assert.equal(slotStateAt(witaInstant("06:59"), config).nextSlot, "07:45");
  assert.equal(slotStateAt(witaInstant("06:59"), config).minutesUntilNextSlot, 46);
});

test("the next slot rolls over to the first slot of the following day", () => {
  const state = slotStateAt(witaInstant("22:00"), config);
  assert.equal(state.active, false);
  assert.equal(state.nextSlot, "06:45");
  assert.equal(state.minutesUntilNextSlot, 8 * 60 + 45);
});

test("slot labels are formatted as HH:MM", () => {
  assert.equal(formatMinutes(405), "06:45");
  assert.equal(formatMinutes(0), "00:00");
  assert.equal(formatMinutes(1440), "00:00");
  assert.equal(formatMinutes(-60), "23:00");
});

test("PUBLISH_SLOTS_WITA overrides the default list and accepts 'off'", () => {
  const custom = loadSlotConfig({ PUBLISH_SLOTS_WITA: "08:00, 12:30,8.00" });
  assert.deepEqual(custom.slots, [480, 750]);
  assert.equal(custom.disabled, false);
  assert.deepEqual(custom.slots.map(formatMinutes), ["08:00", "12:30"]);

  const off = loadSlotConfig({ PUBLISH_SLOTS_WITA: "off" });
  assert.equal(off.disabled, true);
  assert.equal(slotStateAt(witaInstant("03:00"), off).active, true);
  assert.equal(slotStateAt(witaInstant("03:00"), off).enabled, false);

  const invalid = loadSlotConfig({ PUBLISH_SLOTS_WITA: "nonsense" });
  assert.deepEqual(invalid.slots, DEFAULT_SLOTS_WITA.map(timeToMinutes));
  assert.equal(invalid.disabled, false);
});

test("grace minutes fall back to 14 when the env value is unusable", () => {
  assert.equal(loadSlotConfig({}).graceMinutes, 14);
  assert.equal(loadSlotConfig({ PUBLISH_SLOT_GRACE_MINUTES: "20" }).graceMinutes, 20);
  assert.equal(loadSlotConfig({ PUBLISH_SLOT_GRACE_MINUTES: "0" }).graceMinutes, 14);
  assert.equal(loadSlotConfig({ PUBLISH_SLOT_GRACE_MINUTES: "90" }).graceMinutes, 59);
});
