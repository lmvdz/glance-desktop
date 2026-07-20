// `+N −N` diffstat chip (hub-shell H3, r3 borrow 1). Two layouts, per t3code's DiffStatLabel
// (© 2026 T3 Tools Inc., MIT License): `aligned` reserves a 4ch column per side so stats line up
// down a file list; `inline` flows naturally for the card's summary header. Zero-valued sides stay
// blank (t3's `hasNonZeroStat` gate) so an add-only file doesn't render a noisy "−0".

import { cn } from "@/lib/utils";
import { formatCompactCount } from "@/lib/format";

export function DiffStatLabel({
  additions,
  deletions,
  layout = "aligned",
  className,
}: {
  additions: number;
  deletions: number;
  layout?: "aligned" | "inline";
  className?: string;
}) {
  if (additions === 0 && deletions === 0) return null;
  const add = additions > 0 ? `+${formatCompactCount(additions)}` : "";
  const del = deletions > 0 ? `−${formatCompactCount(deletions)}` : "";
  return (
    <span
      className={cn(
        "shrink-0 font-mono text-[10.5px] tabular-nums",
        layout === "aligned"
          ? "grid grid-cols-[4ch_4ch] gap-x-1 text-right"
          : "inline-flex items-center gap-1",
        className,
      )}
    >
      <span className="text-success">{add}</span>
      <span className="text-destructive">{del}</span>
    </span>
  );
}
