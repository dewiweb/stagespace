import { create } from 'zustand';

export type ToastType = 'error' | 'warning' | 'info' | 'success';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  timeout: number; // ms, 0 = sticky
}

interface ToastStore {
  toasts: Toast[];
  push: (type: ToastType, message: string, timeout?: number) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

let counter = 0;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  push: (type, message, timeout = 5000) => {
    const id = `toast-${++counter}`;
    const toast: Toast = { id, type, message, timeout };
    set((s) => ({ toasts: [...s.toasts, toast] }));
    if (timeout > 0) {
      setTimeout(() => get().dismiss(id), timeout);
    }
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  clear: () => set({ toasts: [] }),
}));

/// Helpers — utilisables partout sans import du store
export const toast = {
  error: (msg: string, timeout?: number) => useToastStore.getState().push('error', msg, timeout),
  warning: (msg: string, timeout?: number) => useToastStore.getState().push('warning', msg, timeout),
  info: (msg: string, timeout?: number) => useToastStore.getState().push('info', msg, timeout),
  success: (msg: string, timeout?: number) => useToastStore.getState().push('success', msg, timeout),
};
