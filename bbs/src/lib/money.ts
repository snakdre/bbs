const CENT_PATTERN = /^-?\d+(\.\d+)?$/;

function normalize(input: string | number): string {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      throw new Error(`Invalid money value: ${input}`);
    }
    return input.toString();
  }
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!CENT_PATTERN.test(cleaned)) {
    throw new Error(`Invalid money value: ${input}`);
  }
  return cleaned;
}

function roundHalfAwayFromZero(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : -Math.floor(-value + 0.5);
}

export function toCents(input: string | number): number {
  const normalized = normalize(input);
  const negative = normalized.startsWith("-");
  const abs = negative ? normalized.slice(1) : normalized;
  const [dollars, fraction = ""] = abs.split(".");
  const paddedFraction = (fraction + "000").slice(0, 3);
  const wholeCents = Number(dollars) * 100 + Number(paddedFraction.slice(0, 2));
  const thirdDigit = Number(paddedFraction[2] ?? "0");
  const rounded = wholeCents + (thirdDigit >= 5 ? 1 : 0);
  return negative ? -rounded : rounded;
}

export function fromCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const fraction = remainder.toString().padStart(2, "0");
  return `${negative ? "-" : ""}${dollars}.${fraction}`;
}

export function formatUSD(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = remainder.toString().padStart(2, "0");
  return `${negative ? "-" : ""}$${withCommas}.${fraction}`;
}

export function addCents(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0);
}

export function multiplyCents(cents: number, quantity: number): number {
  return roundHalfAwayFromZero(cents * quantity);
}
