// Pure resolver for the repo a friction gripe (C3 "grr") is filed against. Kept DOM-free and
// side-effect-free so it's unit-testable in isolation from App wiring.
//
// The rule mirrors the spec: when the operator is looking at a fleet tab AND has a unit selected,
// the gripe is about THAT unit's repo; otherwise it defaults to the active workspace cwd (the
// explorer root, which itself falls back to the workspace home). Returns null only when neither is
// known — the modal disables submit in that case rather than filing a repo-less gripe.

export function resolveGrrRepo(opts: {
  fleetTabActive: boolean;
  selectedUnitRepo: string | null;
  workspaceCwd: string | null;
}): string | null {
  if (opts.fleetTabActive && opts.selectedUnitRepo) return opts.selectedUnitRepo;
  return opts.workspaceCwd;
}
