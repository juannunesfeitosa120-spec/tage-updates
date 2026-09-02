const IDLE_BEFORE_UPDATE_MS = 30_000;
const EDITABLE = 'input:not([type="hidden"]), textarea, select, [contenteditable="true"]';
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Keep the restart decision in the renderer: native idle time cannot detect drafts
// or an upload still being sent. No field contents leave this process.
export function installUpdateGuard(target, now = Date.now) {
  const document = target.document;
  const controls = new Map();
  const originalFetch = target.fetch;
  let lastActivity = now();
  let lastWrite = now();
  let pendingWrites = 0;
  let lockedRoot = null;
  let previousInert = false;

  function valueOf(control) {
    if (control.type === 'checkbox' || control.type === 'radio') return control.checked;
    if (control.type === 'file') return control.files?.length ?? 0;
    return control.isContentEditable ? control.textContent : control.value;
  }

  function remember(event) {
    lastActivity = now();
    const control = event.target?.closest?.(EDITABLE);
    if (control && !controls.has(control)) controls.set(control, valueOf(control));
  }

  const activityEvents = ['pointerdown', 'keydown', 'focusin', 'beforeinput', 'change'];
  for (const event of activityEvents) document.addEventListener(event, remember, true);

  target.fetch = async function guardedFetch(input, init) {
    const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
    const writes = !READ_METHODS.has(method);
    if (writes && lockedRoot) {
      throw new DOMException('O Tage está aplicando uma atualização.', 'AbortError');
    }
    if (writes) pendingWrites += 1;
    try {
      return await originalFetch.call(target, input, init);
    } finally {
      if (writes) {
        pendingWrites -= 1;
        lastWrite = now();
      }
    }
  };

  function hasDrafts() {
    for (const [control, initialValue] of controls) {
      if (!control.isConnected) {
        controls.delete(control);
        continue;
      }
      const value = valueOf(control);
      if (value !== initialValue && value !== '') return true;
    }
    return false;
  }

  function prepare() {
    if (lockedRoot) return true;
    if (pendingWrites || now() - lastWrite < 2000 || now() - lastActivity < IDLE_BEFORE_UPDATE_MS || hasDrafts()) {
      return false;
    }
    // A modal may contain unsaved choices, a selected attachment or an operation.
    if ([...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-busy="true"], [data-update-busy="true"]')]
      .some((element) => element.getClientRects().length > 0)) return false;
    const root = document.getElementById('root');
    if (!root) return false;
    previousInert = root.inert;
    lockedRoot = root;
    root.inert = true;
    return true;
  }

  function cancel() {
    if (lockedRoot) lockedRoot.inert = previousInert;
    lockedRoot = null;
  }

  return {
    prepare,
    cancel,
    dispose() {
      cancel();
      target.fetch = originalFetch;
      for (const event of activityEvents) document.removeEventListener(event, remember, true);
    },
  };
}
