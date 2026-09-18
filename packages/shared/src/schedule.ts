export type DailyWindowInput = {
  now: Date;
  timeZone: string;
  publishTime: string;
  scheduleWeekday?: number;
  scheduleMonthDay?: number;
};

export type ScheduleFrequency = "daily" | "weekly" | "monthly" | "on-merge";

export type ChangelogGenerationSource = "pull-requests" | "releases";

export type DailyWindow = {
  startedAt: Date;
  endedAt: Date;
  localDate: string;
};

export type DueInput = DailyWindowInput & {
  lastGeneratedWindowEnd: Date | string | null;
  frequency?: ScheduleFrequency;
};

export type HistoricalScheduleWindowInput = DailyWindowInput & {
  frequency: ScheduleFrequency;
  days: number;
};

export type HistoricalDateRangeWindowInput = {
  startDate: string;
  endDate: string;
  timeZone: string;
};

export type NextScheduledRunInput = DailyWindowInput & {
  frequency: ScheduleFrequency;
};

export function getLastCompletedDailyWindow(
  input: DailyWindowInput,
): DailyWindow {
  const localNow = getLocalParts(input.now, input.timeZone);
  const publishMinutes = parsePublishTime(input.publishTime);
  const localNowMinutes = localNow.hour * 60 + localNow.minute;
  const endLocalDate =
    localNowMinutes >= publishMinutes
      ? localNow.date
      : addDaysToLocalDate(localNow.date, -1);
  const startLocalDate = addDaysToLocalDate(endLocalDate, -1);
  const [hour, minute] = input.publishTime.split(":").map(Number) as [
    number,
    number,
  ];

  return {
    startedAt: localDateTimeToUtc(startLocalDate, hour, minute, input.timeZone),
    endedAt: localDateTimeToUtc(endLocalDate, hour, minute, input.timeZone),
    localDate: endLocalDate,
  };
}

export function getLastCompletedScheduleWindow(
  input: DailyWindowInput & { frequency: ScheduleFrequency },
): DailyWindow {
  if (input.frequency === "daily" || input.frequency === "on-merge") {
    return getLastCompletedDailyWindow(input);
  }

  if (input.frequency === "weekly") {
    return getLastCompletedWeeklyWindow(input);
  }

  return getLastCompletedMonthlyWindow(input);
}

export function getNextScheduledRun(input: NextScheduledRunInput): Date {
  if (input.frequency === "on-merge") {
    throw new Error("Merge-triggered schedules do not have a next run time.");
  }

  const localNow = getLocalParts(input.now, input.timeZone);
  const [hour, minute] = input.publishTime.split(":").map(Number) as [
    number,
    number,
  ];
  parsePublishTime(input.publishTime);

  let localDate = localNow.date;
  if (input.frequency === "weekly") {
    const scheduleWeekday = normalizeScheduleWeekday(input.scheduleWeekday);
    localDate = addDaysToLocalDate(
      localNow.date,
      daysUntilWeekday(localNow.date, scheduleWeekday),
    );
  } else if (input.frequency === "monthly") {
    localDate = getScheduleDateForMonth(
      localNow.date,
      normalizeScheduleMonthDay(input.scheduleMonthDay),
    );
  }

  let nextRun = localDateTimeToUtc(localDate, hour, minute, input.timeZone);
  if (nextRun.getTime() > input.now.getTime()) {
    return nextRun;
  }

  if (input.frequency === "daily") {
    localDate = addDaysToLocalDate(localDate, 1);
  } else if (input.frequency === "weekly") {
    localDate = addDaysToLocalDate(localDate, 7);
  } else {
    localDate = getScheduleDateForMonth(
      addMonthsToLocalMonth(localDate, 1),
      normalizeScheduleMonthDay(input.scheduleMonthDay),
    );
  }

  nextRun = localDateTimeToUtc(localDate, hour, minute, input.timeZone);
  return nextRun;
}

export function getHistoricalScheduleWindows(
  input: HistoricalScheduleWindowInput,
): DailyWindow[] {
  if (!Number.isInteger(input.days) || input.days < 1) {
    throw new Error("Historical window days must be a positive integer.");
  }

  const lastWindow = getLastCompletedDailyWindow(input);
  const [hour, minute] = input.publishTime.split(":").map(Number) as [
    number,
    number,
  ];
  const rangeEndLocalDate = lastWindow.localDate;
  const rangeStartLocalDate = addDaysToLocalDate(
    rangeEndLocalDate,
    -input.days,
  );

  if (input.frequency === "daily" || input.frequency === "on-merge") {
    return buildFixedDayWindows({
      daysPerWindow: 1,
      rangeStartLocalDate,
      rangeEndLocalDate,
      hour,
      minute,
      timeZone: input.timeZone,
    });
  }

  if (input.frequency === "weekly") {
    return buildFixedDayWindows({
      daysPerWindow: 7,
      rangeStartLocalDate,
      rangeEndLocalDate,
      hour,
      minute,
      timeZone: input.timeZone,
    });
  }

  return buildMonthlyWindows({
    rangeStartLocalDate,
    rangeEndLocalDate,
    hour,
    minute,
    timeZone: input.timeZone,
  });
}

export function getHistoricalDateRangeWindow(
  input: HistoricalDateRangeWindowInput,
): DailyWindow {
  if (!isValidLocalDate(input.startDate) || !isValidLocalDate(input.endDate)) {
    throw new Error("Backfill dates must use the YYYY-MM-DD format.");
  }

  if (compareLocalDates(input.startDate, input.endDate) > 0) {
    throw new Error(
      "The backfill start date must be on or before the end date.",
    );
  }

  return {
    startedAt: localDateTimeToUtc(input.startDate, 0, 0, input.timeZone),
    endedAt: localDateTimeToUtc(
      addDaysToLocalDate(input.endDate, 1),
      0,
      0,
      input.timeZone,
    ),
    localDate: input.endDate,
  };
}

export function isChangelogDue(input: DueInput): boolean {
  const frequency = input.frequency ?? "daily";
  if (frequency === "on-merge") {
    return false;
  }
  const localNow = getLocalParts(input.now, input.timeZone);
  const publishMinutes = parsePublishTime(input.publishTime);
  const localNowMinutes = localNow.hour * 60 + localNow.minute;

  if (frequency === "daily" && localNowMinutes < publishMinutes) {
    return false;
  }

  if (!input.lastGeneratedWindowEnd) {
    if (frequency === "weekly") {
      const scheduledToday =
        daysSinceWeekday(
          localNow.date,
          normalizeScheduleWeekday(input.scheduleWeekday),
        ) === 0;
      if (!scheduledToday || localNowMinutes < publishMinutes) {
        return false;
      }
    }

    if (frequency === "monthly") {
      const scheduledDate = getScheduleDateForMonth(
        localNow.date,
        normalizeScheduleMonthDay(input.scheduleMonthDay),
      );
      if (localNow.date !== scheduledDate || localNowMinutes < publishMinutes) {
        return false;
      }
    }
  }

  const window = getLastCompletedScheduleWindow({
    ...input,
    frequency,
  });

  if (!input.lastGeneratedWindowEnd) {
    return true;
  }

  const lastGenerated =
    input.lastGeneratedWindowEnd instanceof Date
      ? input.lastGeneratedWindowEnd
      : new Date(input.lastGeneratedWindowEnd);

  return lastGenerated.getTime() < window.endedAt.getTime();
}

function getLastCompletedWeeklyWindow(input: DailyWindowInput): DailyWindow {
  const localNow = getLocalParts(input.now, input.timeZone);
  const publishMinutes = parsePublishTime(input.publishTime);
  const localNowMinutes = localNow.hour * 60 + localNow.minute;
  const scheduledDate = addDaysToLocalDate(
    localNow.date,
    -daysSinceWeekday(
      localNow.date,
      normalizeScheduleWeekday(input.scheduleWeekday),
    ),
  );
  const endLocalDate =
    localNow.date === scheduledDate && localNowMinutes < publishMinutes
      ? addDaysToLocalDate(scheduledDate, -7)
      : scheduledDate;
  const startLocalDate = addDaysToLocalDate(endLocalDate, -7);
  const [hour, minute] = input.publishTime.split(":").map(Number) as [
    number,
    number,
  ];

  return {
    startedAt: localDateTimeToUtc(startLocalDate, hour, minute, input.timeZone),
    endedAt: localDateTimeToUtc(endLocalDate, hour, minute, input.timeZone),
    localDate: endLocalDate,
  };
}

function getLastCompletedMonthlyWindow(input: DailyWindowInput): DailyWindow {
  const localNow = getLocalParts(input.now, input.timeZone);
  const publishMinutes = parsePublishTime(input.publishTime);
  const localNowMinutes = localNow.hour * 60 + localNow.minute;
  const scheduleMonthDay = normalizeScheduleMonthDay(input.scheduleMonthDay);
  const scheduledDate = getScheduleDateForMonth(
    localNow.date,
    scheduleMonthDay,
  );
  const endLocalDate =
    compareLocalDates(localNow.date, scheduledDate) < 0 ||
    (localNow.date === scheduledDate && localNowMinutes < publishMinutes)
      ? getScheduleDateForMonth(
          addMonthsToLocalMonth(scheduledDate, -1),
          scheduleMonthDay,
        )
      : scheduledDate;
  const startLocalDate = getScheduleDateForMonth(
    addMonthsToLocalMonth(endLocalDate, -1),
    scheduleMonthDay,
  );
  const [hour, minute] = input.publishTime.split(":").map(Number) as [
    number,
    number,
  ];

  return {
    startedAt: localDateTimeToUtc(startLocalDate, hour, minute, input.timeZone),
    endedAt: localDateTimeToUtc(endLocalDate, hour, minute, input.timeZone),
    localDate: endLocalDate,
  };
}

function buildFixedDayWindows(input: {
  rangeStartLocalDate: string;
  rangeEndLocalDate: string;
  daysPerWindow: number;
  hour: number;
  minute: number;
  timeZone: string;
}): DailyWindow[] {
  const windows: DailyWindow[] = [];
  let startLocalDate = input.rangeStartLocalDate;

  while (compareLocalDates(startLocalDate, input.rangeEndLocalDate) < 0) {
    const endLocalDate = minLocalDate(
      addDaysToLocalDate(startLocalDate, input.daysPerWindow),
      input.rangeEndLocalDate,
    );
    windows.push({
      startedAt: localDateTimeToUtc(
        startLocalDate,
        input.hour,
        input.minute,
        input.timeZone,
      ),
      endedAt: localDateTimeToUtc(
        endLocalDate,
        input.hour,
        input.minute,
        input.timeZone,
      ),
      localDate: endLocalDate,
    });
    startLocalDate = endLocalDate;
  }

  return windows;
}

function buildMonthlyWindows(input: {
  rangeStartLocalDate: string;
  rangeEndLocalDate: string;
  hour: number;
  minute: number;
  timeZone: string;
}): DailyWindow[] {
  const windows: DailyWindow[] = [];
  let startLocalDate = input.rangeStartLocalDate;

  while (compareLocalDates(startLocalDate, input.rangeEndLocalDate) < 0) {
    const nextMonth = addMonthsToLocalMonth(
      `${startLocalDate.slice(0, 8)}01`,
      1,
    );
    const endLocalDate = minLocalDate(nextMonth, input.rangeEndLocalDate);
    windows.push({
      startedAt: localDateTimeToUtc(
        startLocalDate,
        input.hour,
        input.minute,
        input.timeZone,
      ),
      endedAt: localDateTimeToUtc(
        endLocalDate,
        input.hour,
        input.minute,
        input.timeZone,
      ),
      localDate: endLocalDate,
    });
    startLocalDate = endLocalDate;
  }

  return windows;
}

function parsePublishTime(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);

  if (!match) {
    throw new Error(`Invalid publish time: ${value}`);
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function getLocalParts(
  date: Date,
  timeZone: string,
): {
  date: string;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function localDateTimeToUtc(
  localDate: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const [year, month, day] = localDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  for (let index = 0; index < 2; index += 1) {
    const offset = getTimeZoneOffsetMs(candidate, timeZone);
    candidate = new Date(
      Date.UTC(year, month - 1, day, hour, minute, 0, 0) - offset,
    );
  }

  return candidate;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const local = getLocalParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(local.date.slice(0, 4)),
    Number(local.date.slice(5, 7)) - 1,
    Number(local.date.slice(8, 10)),
    local.hour,
    local.minute,
    local.second,
  );

  return asUtc - date.getTime();
}

function addDaysToLocalDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return date.toISOString().slice(0, 10);
}

function isValidLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function addMonthsToLocalMonth(localDate: string, months: number): string {
  const [year, month] = localDate.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + months, 1));

  return date.toISOString().slice(0, 10);
}

function compareLocalDates(a: string, b: string): number {
  return a.localeCompare(b);
}

function minLocalDate(a: string, b: string): string {
  return compareLocalDates(a, b) < 0 ? a : b;
}

function daysSinceWeekday(localDate: string, weekday: number): number {
  const [year, month, day] = localDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return (dayOfWeek - weekday + 7) % 7;
}

function daysUntilWeekday(localDate: string, weekday: number): number {
  const [year, month, day] = localDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return (weekday - dayOfWeek + 7) % 7;
}

function normalizeScheduleWeekday(value: number | undefined): number {
  return Number.isInteger(value) &&
    value !== undefined &&
    value >= 0 &&
    value <= 6
    ? value
    : 1;
}

function normalizeScheduleMonthDay(value: number | undefined): number {
  return Number.isInteger(value) &&
    value !== undefined &&
    value >= 1 &&
    value <= 31
    ? value
    : 1;
}

function getScheduleDateForMonth(
  localDate: string,
  scheduleMonthDay: number,
): string {
  const [year, month] = localDate.split("-").map(Number) as [number, number];
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(scheduleMonthDay, lastDayOfMonth);

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
