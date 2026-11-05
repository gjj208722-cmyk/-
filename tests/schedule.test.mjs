import test from "node:test";
import assert from "node:assert/strict";
import { getScheduleState, parseOpenWindows, zonedDayKey, zonedMinuteStamp } from "../lib/schedule.mjs";

const windows = parseOpenWindows("2026-11-06 09:00-10:00, 2026-11-07 14:00-15:00");

test("开放时段按东八区解析，并支持多个时段", () => {
  assert.equal(windows.length, 2);
  assert.equal(windows[0].startLabel, "2026-11-06 09:00");
  assert.equal(zonedMinuteStamp(new Date("2026-11-06T01:30:00Z"), "Asia/Shanghai"), 202611060930);
  assert.equal(zonedDayKey(new Date("2026-11-06T01:30:00Z"), "Asia/Shanghai"), "2026-11-06");
});

test("只在开放时段内开放，并返回下一次开放时间", () => {
  const open = getScheduleState({
    enabled: true,
    windows,
    timeZone: "Asia/Shanghai",
    now: new Date("2026-11-06T01:30:00Z"),
    dailyLimit: 50,
    dailyCount: 0
  });
  assert.equal(open.open, true);
  assert.equal(open.currentWindow, "2026-11-06 09:00-10:00");
  assert.equal(open.nextOpenAt, "2026-11-07 14:00");

  const closed = getScheduleState({
    enabled: true,
    windows,
    timeZone: "Asia/Shanghai",
    now: new Date("2026-11-06T02:00:00Z"),
    dailyLimit: 50,
    dailyCount: 0
  });
  assert.equal(closed.open, false);
  assert.equal(closed.nextOpenAt, "2026-11-07 14:00");
});

test("每日额度用完后，即使处于开放时段也不可用", () => {
  const state = getScheduleState({
    enabled: true,
    windows,
    timeZone: "Asia/Shanghai",
    now: new Date("2026-11-06T01:30:00Z"),
    dailyLimit: 1,
    dailyCount: 1
  });
  assert.equal(state.open, true);
  assert.equal(state.quotaAvailable, false);
  assert.equal(state.remainingToday, 0);
});

test("未启用、无时段或格式错误时保持关闭", () => {
  assert.equal(parseOpenWindows("not-a-window").length, 0);
  const state = getScheduleState({
    enabled: true,
    windows: [],
    timeZone: "Asia/Shanghai",
    now: new Date("2026-11-06T01:30:00Z"),
    dailyLimit: 50,
    dailyCount: 0
  });
  assert.equal(state.open, false);
  assert.equal(state.nextOpenAt, null);
});
