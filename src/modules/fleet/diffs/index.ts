// One t3-grade diff surface, shared by the fleet IntervenePane and the AI
// PlanDiffReview (concern 10, escape-hatch — no @pierre/diffs, see PR).
export { DiffFile, type DiffViewMode, type QuotePayload } from "./DiffFile";
export { DiffViewToggle } from "./DiffViewToggle";
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
