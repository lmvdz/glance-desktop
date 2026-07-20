// One t3-grade diff surface, shared by the fleet IntervenePane and the AI
// PlanDiffReview (concern 10, escape-hatch — no @pierre/diffs, see PR).
export { DiffFile, type DiffViewMode, type QuotePayload } from "./DiffFile";
export { DiffViewToggle } from "./DiffViewToggle";
// ChangedFilesCard (+ fileTree/DiffStatLabel) is deliberately NOT re-exported here: IntervenePane
// loads it through a lazy boundary to keep the card's machinery out of the eager client-JS budget,
// and a barrel re-export would drag it back into every "./diffs" importer's chunk.
export {
  type DiffLine,
  type ParsedDiff,
  type SplitCell,
  type SplitRow,
  lineDiff,
  linePrefix,
  parseUnifiedDiff,
  toSplitRows,
} from "./parseDiff";
