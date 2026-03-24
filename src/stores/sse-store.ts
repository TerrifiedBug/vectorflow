import { create } from "zustand";

type SSEConnectionStatus = "connected" | "disconnected" | "reconnecting";

interface SSEStore {
  status: SSEConnectionStatus;
  lastConnectedAt: number | null;
  setStatus: (status: SSEConnectionStatus) => void;
  setLastConnectedAt: (ts: number | null) => void;
}

export const useSSEStore = create<SSEStore>()((set) => ({
  status: "disconnected",
  lastConnectedAt: null,
  setStatus: (status) => set({ status }),
  setLastConnectedAt: (ts) => set({ lastConnectedAt: ts }),
}));
