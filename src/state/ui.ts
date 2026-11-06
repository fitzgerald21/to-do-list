import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  error?: boolean;
}

let toasts: Toast[] = [];
const subs = new Set<() => void>();
let n = 0;

export function toast(text: string, opts: { action?: Toast["action"]; error?: boolean; ms?: number } = {}) {
  const t: Toast = { id: ++n, text, action: opts.action, error: opts.error };
  toasts = [...toasts, t].slice(-2);
  subs.forEach((f) => f());
  setTimeout(() => dismiss(t.id), opts.ms ?? (opts.action ? 8000 : 4000));
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  subs.forEach((f) => f());
}

export function useToasts() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => toasts,
  );
}
