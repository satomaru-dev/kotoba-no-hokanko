import type { DoLaterDeferral } from "./types";

const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

export const formatJstDateTime = (value: string): string => {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
};

export const deferralsToCsv = (items: DoLaterDeferral[]): string => {
  const rows = [
    ["延期日時（JST）", "まだやらない理由", "延期時点のメモ本文"],
    ...items.map((item) => [formatJstDateTime(item.deferred_at), item.reason, item.memo_text])
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
};

export const jstDateForFilename = (value = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
