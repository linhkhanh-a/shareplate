/**
 * In-app "are you sure?" dialogs, instead of the browser's own pop-ups.
 * Any code can ask with `askConfirm(...)`; the one <AppDialogHost /> in the
 * root layout shows the question and answers the promise.
 */

export interface ConfirmRequest {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  /** Red confirm button for deleting, removing, leaving and the like. */
  destructive: boolean;
  resolve: (ok: boolean) => void;
}

let queue: ConfirmRequest[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Words that mean something goes away, so the button is shown in red. */
const DESTRUCTIVE = /^(delete|remove|leave|discard|clear|start over|reset|undo|switch)/i;

export function askConfirm(title: string, message: string, confirmLabel: string, destructive?: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [
      ...queue,
      {
        id: nextId++,
        title,
        message,
        confirmLabel,
        destructive: destructive ?? DESTRUCTIVE.test(confirmLabel),
        resolve,
      },
    ];
    emit();
  });
}

/** Whether any dialog host is on screen to answer (otherwise fall back to the platform's own). */
export function hasDialogHost(): boolean {
  return listeners.size > 0;
}

/** The question on screen now, if any. */
export function currentDialog(): ConfirmRequest | null {
  return queue[0] ?? null;
}

export function answerDialog(id: number, ok: boolean): void {
  const request = queue.find((r) => r.id === id);
  if (!request) return;
  queue = queue.filter((r) => r.id !== id);
  emit();
  request.resolve(ok);
}

export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
