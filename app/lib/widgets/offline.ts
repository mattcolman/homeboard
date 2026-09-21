import type { Board, Widget } from './model';

const NAME = 'homeboard-widgets-v1';
type Saved = {
  board: Board;
  savedAt: number;
  pending: Record<string, { stepId: string; revision: number }>;
};
let writes: Promise<unknown> = Promise.resolve();
function serialise<T>(operation: () => Promise<T>): Promise<T> {
  const next = writes.then(operation, operation);
  writes = next.catch(() => {});
  return next;
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('board');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function put(value: Saved) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('board', 'readwrite');
    tx.objectStore('board').put(value, 'approved');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
export async function readOffline(): Promise<Saved | null> {
  try {
    const db = await database();
    const saved = await new Promise<Saved | undefined>((resolve, reject) => {
      const req = db.transaction('board').objectStore('board').get('approved');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!saved || Date.now() - saved.savedAt > 86400e3) return null;
    return saved;
  } catch {
    return null;
  }
}
export function saveOffline(board: Board) {
  return serialise(async () => {
    const existing = await readOffline();
    const safe = board.widgets
      .filter((w) => w.offlineAllowed && !w.archived)
      .map((w) => ({
        ...w,
        definition:
          w.definition.kind === 'module'
            ? {
                ...w.definition,
                kind: 'composition' as const,
                module: undefined,
              }
            : w.definition,
      }));
    await put({
      board: { ...board, widgets: safe },
      savedAt: Date.now(),
      pending:
        existing?.board.cacheScope === board.cacheScope ? existing.pending : {},
    });
  });
}
export function saveOfflineStep(widget: Widget, stepId: string) {
  return serialise(async () => {
    const saved = await readOffline();
    if (!saved) return;
    saved.board.widgets = saved.board.widgets.map((w) =>
      w.id === widget.id ? { ...w, state: { ...w.state, stepId } } : w,
    );
    saved.pending[widget.id] = { stepId, revision: widget.revision };
    await put(saved);
  });
}
export function clearOffline() {
  return serialise(async () => {
    try {
      const db = await database();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('board', 'readwrite');
        tx.objectStore('board').clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch {
      /* An unavailable device cache must not prevent sign-out. */
    }
  });
}
export function clearPending(ids: string[]) {
  return serialise(async () => {
    const saved = await readOffline();
    if (saved) {
      for (const id of ids) delete saved.pending[id];
      await put(saved);
    }
  });
}
