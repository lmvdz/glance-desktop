/** Compact human count — 1234 → "1.2k", 3_400_000 → "3.4m" (t3's `formatCompactDiffCount`
 *  shape, © 2026 T3 Tools Inc., MIT License). Trims a trailing ".0". */
export function formatCompactCount(n: number): string {
  const abs = Math.abs(n);
  const render = (value: number, suffix: string) => {
    const rounded = (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "");
    return `${n < 0 ? "-" : ""}${rounded}${suffix}`;
  };
  if (abs >= 1e9) return render(abs / 1e9, "b");
  if (abs >= 1e6) return render(abs / 1e6, "m");
  if (abs >= 1e3) return render(abs / 1e3, "k");
  return String(n);
}
