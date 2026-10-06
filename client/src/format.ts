/** Number formatting shared by the metric views. */
export function fmt(n: number, digits = 2): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

/** Integers with an explicit sign (growth columns). */
export function fmtSigned(n: number): string {
  return `${n > 0 ? '+' : ''}${fmt(n)}`;
}

export function fmtPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
