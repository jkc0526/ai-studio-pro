// Keep saves in edit order so a slow earlier request cannot overwrite a newer canvas.
export function createCanvasSaveQueue({ save, onState = () => {}, delayMs = 900 }) {
  let pending = null;
  let timer = null;
  let tail = Promise.resolve();
  let writing = false;
  let revision = 0;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const flush = async () => {
    clearTimer();
    if (!pending) return tail;
    const snapshot = pending;
    const savingRevision = revision;
    pending = null;
    const action = tail.catch(() => {}).then(async () => {
      writing = true;
      if (!pending && revision === savingRevision) onState('saving', snapshot);
      try { return await save(snapshot); }
      finally { writing = false; }
    });
    tail = action;
    try {
      await action;
      if (!pending && revision === savingRevision) onState('saved', snapshot);
    } catch (error) {
      if (!pending && revision === savingRevision) {
        pending = snapshot;
        onState('error', snapshot, error);
      }
      throw error;
    }
  };

  const schedule = (snapshot) => {
    pending = snapshot;
    revision += 1;
    clearTimer();
    onState('unsaved', snapshot);
    timer = setTimeout(() => { void flush().catch(() => {}); }, delayMs);
  };

  return { schedule, flush, hasPending: () => Boolean(pending || writing) };
}
