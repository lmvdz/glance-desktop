import { create } from "zustand";

// Which unit's intervene detail is open, lifted out of RosterView (C07 kept it local) so a
// notification click (C08) can focus a specific unit from outside the component tree.
//
// `selectedId` holds a roster `unitKey` (`daemonId:id`, see fleetRoster.ts), NOT a bare unit id
// (M02) — unit ids are only unique within their own daemon, so a bare id would be ambiguous
// the moment two daemons are connected.

type FleetSelectionState = {
  selectedId: string | null;
  select: (id: string | null) => void;
};

export const useFleetSelection = create<FleetSelectionState>((set) => ({
  selectedId: null,
  select: (id) => set({ selectedId: id }),
}));
