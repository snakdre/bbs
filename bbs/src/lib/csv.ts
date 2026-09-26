const BOM = "﻿";
const CRLF = "\r\n";

function escapeField(value: string): string {
  if (value === "") return "";
  const needsQuoting = /[",\r\n]/.test(value);
  if (!needsQuoting) return value;
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(escapeField).join(",");
  const bodyLines = rows.map((row) => row.map(escapeField).join(","));
  const allLines = [headerLine, ...bodyLines];
  return BOM + allLines.join(CRLF) + CRLF;
}
