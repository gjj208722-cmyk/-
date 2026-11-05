const DEFAULT_TIMEZONE = "Asia/Shanghai";

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute
  };
}

export function zonedMinuteStamp(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = zonedParts(date, timeZone);
  return Number(`${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`);
}

export function zonedDayKey(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function normalizeTimeZone(value) {
  const candidate = String(value || "").trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function parseOpenWindows(value) {
  const windows = [];
  for (const raw of String(value || "").split(/[,\n;]+/)) {
    const text = raw.trim();
    if (!text) continue;
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*[-~至]\s*(\d{1,2}):(\d{2})$/);
    if (!match) continue;
    const [, year, month, day, startHour, startMinute, endHour, endMinute] = match;
    const startStamp = Number(`${year}${month}${day}${String(startHour).padStart(2, "0")}${startMinute}`);
    const endStamp = Number(`${year}${month}${day}${String(endHour).padStart(2, "0")}${endMinute}`);
    if (endStamp <= startStamp) continue;
    windows.push({
      label: text,
      startLabel: `${year}-${month}-${day} ${String(startHour).padStart(2, "0")}:${startMinute}`,
      startStamp,
      endStamp
    });
  }
  return windows.sort((left, right) => left.startStamp - right.startStamp);
}

export function getScheduleState({
  enabled = false,
  windows = [],
  timeZone = DEFAULT_TIMEZONE,
  now = new Date(),
  dailyLimit = 50,
  dailyCount = 0
} = {}) {
  const zone = normalizeTimeZone(timeZone);
  const stamp = zonedMinuteStamp(now, zone);
  const current = windows.find((window) => stamp >= window.startStamp && stamp < window.endStamp) || null;
  const next = windows.find((window) => window.startStamp > stamp) || null;
  const remainingToday = Math.max(0, Number(dailyLimit || 0) - Number(dailyCount || 0));
  return {
    enabled: Boolean(enabled),
    timezone: zone,
    open: Boolean(enabled && current),
    currentWindow: current?.label || null,
    nextOpenAt: next?.startLabel || null,
    windows: windows.map((window) => window.label),
    dailyLimit: Number(dailyLimit || 0),
    remainingToday,
    quotaAvailable: remainingToday > 0
  };
}
