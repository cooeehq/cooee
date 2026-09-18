import { describe, expect, test } from "bun:test";
import {
  getHistoricalDateRangeWindow,
  getLastCompletedDailyWindow,
  getLastCompletedScheduleWindow,
  getNextScheduledRun,
  isChangelogDue,
} from "../schedule";

describe("daily schedule windows", () => {
  test("calculates the last completed window in the repository timezone", () => {
    const window = getLastCompletedDailyWindow({
      now: new Date("2026-06-06T00:30:00.000Z"),
      timeZone: "Australia/Brisbane",
      publishTime: "09:00",
    });

    expect(window.startedAt.toISOString()).toBe("2026-06-04T23:00:00.000Z");
    expect(window.endedAt.toISOString()).toBe("2026-06-05T23:00:00.000Z");
    expect(window.localDate).toBe("2026-06-06");
  });

  test("does not mark a changelog due before local publish time", () => {
    expect(
      isChangelogDue({
        now: new Date("2026-06-05T22:59:00.000Z"),
        timeZone: "Australia/Brisbane",
        publishTime: "09:00",
        lastGeneratedWindowEnd: null,
      }),
    ).toBe(false);
  });

  test("calculates weekly and monthly cadence windows", () => {
    const weekly = getLastCompletedScheduleWindow({
      now: new Date("2026-06-03T00:30:00.000Z"),
      timeZone: "Australia/Brisbane",
      publishTime: "09:00",
      frequency: "weekly",
    });
    expect(weekly.startedAt.toISOString()).toBe("2026-05-24T23:00:00.000Z");
    expect(weekly.endedAt.toISOString()).toBe("2026-05-31T23:00:00.000Z");

    const monthly = getLastCompletedScheduleWindow({
      now: new Date("2026-06-07T00:30:00.000Z"),
      timeZone: "Australia/Brisbane",
      publishTime: "09:00",
      frequency: "monthly",
    });
    expect(monthly.startedAt.toISOString()).toBe("2026-04-30T23:00:00.000Z");
    expect(monthly.endedAt.toISOString()).toBe("2026-05-31T23:00:00.000Z");
  });

  test("marks weekly changelogs due until the latest cadence window is generated", () => {
    expect(
      isChangelogDue({
        now: new Date("2026-06-03T00:30:00.000Z"),
        timeZone: "Australia/Brisbane",
        publishTime: "09:00",
        frequency: "weekly",
        lastGeneratedWindowEnd: "2026-05-24T23:00:00.000Z",
      }),
    ).toBe(true);

    expect(
      isChangelogDue({
        now: new Date("2026-06-03T00:30:00.000Z"),
        timeZone: "Australia/Brisbane",
        publishTime: "09:00",
        frequency: "weekly",
        lastGeneratedWindowEnd: "2026-05-31T23:00:00.000Z",
      }),
    ).toBe(false);
  });

  test("calculates the next daily, weekly, and monthly scheduled runs", () => {
    const now = new Date("2026-06-03T00:30:00.000Z");

    expect(
      getNextScheduledRun({
        now,
        timeZone: "Australia/Brisbane",
        publishTime: "09:00",
        frequency: "daily",
      }).toISOString(),
    ).toBe("2026-06-03T23:00:00.000Z");
    expect(
      getNextScheduledRun({
        now,
        timeZone: "Australia/Brisbane",
        publishTime: "09:00",
        frequency: "weekly",
      }).toISOString(),
    ).toBe("2026-06-07T23:00:00.000Z");
    expect(
      getNextScheduledRun({
        now,
        timeZone: "Australia/Brisbane",
        publishTime: "09:00",
        frequency: "monthly",
      }).toISOString(),
    ).toBe("2026-06-30T23:00:00.000Z");
  });

  test("uses the configured weekday and time for weekly runs", () => {
    const input = {
      now: new Date("2026-06-03T00:30:00.000Z"),
      timeZone: "Australia/Brisbane",
      publishTime: "09:00",
      frequency: "weekly" as const,
      scheduleWeekday: 3,
    };

    const window = getLastCompletedScheduleWindow(input);
    expect(window.startedAt.toISOString()).toBe("2026-05-26T23:00:00.000Z");
    expect(window.endedAt.toISOString()).toBe("2026-06-02T23:00:00.000Z");
    expect(getNextScheduledRun(input).toISOString()).toBe(
      "2026-06-09T23:00:00.000Z",
    );
  });

  test("uses the configured month day and falls back to the last day of shorter months", () => {
    const midMonth = {
      now: new Date("2026-06-07T00:30:00.000Z"),
      timeZone: "Australia/Brisbane",
      publishTime: "09:00",
      frequency: "monthly" as const,
      scheduleMonthDay: 15,
    };
    const window = getLastCompletedScheduleWindow(midMonth);
    expect(window.startedAt.toISOString()).toBe("2026-04-14T23:00:00.000Z");
    expect(window.endedAt.toISOString()).toBe("2026-05-14T23:00:00.000Z");
    expect(getNextScheduledRun(midMonth).toISOString()).toBe(
      "2026-06-14T23:00:00.000Z",
    );

    expect(
      getNextScheduledRun({
        ...midMonth,
        now: new Date("2026-04-29T23:30:00.000Z"),
        scheduleMonthDay: 31,
      }).toISOString(),
    ).toBe("2026-05-30T23:00:00.000Z");
  });

  test("does not put merge-triggered changelogs on the timed scheduler", () => {
    expect(
      isChangelogDue({
        now: new Date("2026-06-03T00:30:00.000Z"),
        timeZone: "Australia/Brisbane",
        publishTime: "09:00",
        frequency: "on-merge",
        lastGeneratedWindowEnd: null,
      }),
    ).toBe(false);
  });

  test("waits for the configured weekly day and time before the first run", () => {
    const schedule = {
      timeZone: "Australia/Brisbane",
      publishTime: "14:30",
      frequency: "weekly" as const,
      scheduleWeekday: 3,
      lastGeneratedWindowEnd: null,
    };

    expect(
      isChangelogDue({
        ...schedule,
        now: new Date("2026-06-09T04:30:00.000Z"),
      }),
    ).toBe(false);
    expect(
      isChangelogDue({
        ...schedule,
        now: new Date("2026-06-10T04:29:00.000Z"),
      }),
    ).toBe(false);
    expect(
      isChangelogDue({
        ...schedule,
        now: new Date("2026-06-10T04:30:00.000Z"),
      }),
    ).toBe(true);
  });

  test("keeps the configured local time across daylight-saving changes", () => {
    const nextRun = getNextScheduledRun({
      now: new Date("2026-03-28T12:00:00.000Z"),
      timeZone: "Europe/London",
      publishTime: "09:00",
      frequency: "daily",
    });

    expect(nextRun.toISOString()).toBe("2026-03-29T08:00:00.000Z");
  });

  test("uses complete local days for an explicit historical date range", () => {
    const window = getHistoricalDateRangeWindow({
      startDate: "2026-06-04",
      endDate: "2026-06-06",
      timeZone: "Australia/Brisbane",
    });

    expect(window.startedAt.toISOString()).toBe("2026-06-03T14:00:00.000Z");
    expect(window.endedAt.toISOString()).toBe("2026-06-06T14:00:00.000Z");
  });

  test("rejects an inverted explicit historical date range", () => {
    expect(() =>
      getHistoricalDateRangeWindow({
        startDate: "2026-06-07",
        endDate: "2026-06-06",
        timeZone: "Australia/Brisbane",
      }),
    ).toThrow("start date");
  });
});
