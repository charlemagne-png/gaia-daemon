// GaiaVoice transcript merge window: hold short VAD-sliced transcripts so
// natural thinking pauses remain one message, while 10s cap-chopped clips wait
// for their continuation instead of shipping alone.

export const MERGE_WINDOW_MS = 2_500;

/** @typedef {{ mustMergeNext?: boolean }} MergeAcceptOptions */

/**
 * @param {{
 *   dispatch: (text: string) => void | Promise<void>,
 *   setTimeout?: (fn: () => void, ms: number) => unknown,
 *   clearTimeout?: (id: unknown) => void,
 *   autoDispatch?: boolean,
 *   onChange?: (text: string) => void,
 * }} options
 */
export function createVoiceTranscriptMerger(options) {
  const setTimer = options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer = options.clearTimeout ?? ((id) => globalThis.clearTimeout(/** @type {ReturnType<typeof globalThis.setTimeout>} */ (id)));
  /** @type {unknown} */
  let timer = null;
  let pendingText = "";
  let waitingForContinuation = false;
  let mustMergeNext = false;
  const autoDispatch = options.autoDispatch !== false;

  function notifyChange() {
    options.onChange?.(pendingText);
  }

  function clearHoldTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function resetPending() {
    clearHoldTimer();
    pendingText = "";
    waitingForContinuation = false;
    mustMergeNext = false;
    notifyChange();
  }

  function scheduleHold() {
    clearHoldTimer();
    if (!autoDispatch || !pendingText || waitingForContinuation || mustMergeNext) return;
    timer = setTimer(() => {
      const text = pendingText;
      resetPending();
      void options.dispatch(text);
    }, MERGE_WINDOW_MS);
  }

  return {
    /** A new speech segment began before the held text dispatched. */
    segmentStarted() {
      if (!pendingText) return;
      waitingForContinuation = true;
      clearHoldTimer();
    },

    /** @param {string} text @param {MergeAcceptOptions} [acceptOptions] */
    accept(text, acceptOptions = {}) {
      const trimmed = text.trim();
      if (trimmed) pendingText = pendingText ? `${pendingText} ${trimmed}` : trimmed;
      waitingForContinuation = false;
      mustMergeNext = Boolean(acceptOptions.mustMergeNext);
      notifyChange();
      scheduleHold();
    },

    /** Dispatch any non-cap-held text now; cap-held text still obeys never-alone. */
    flushReady() {
      if (!pendingText || waitingForContinuation || mustMergeNext) return;
      const text = pendingText;
      resetPending();
      void options.dispatch(text);
    },

    /** Human commit: dispatches the composed utterance immediately. */
    send() {
      if (!pendingText) return;
      const text = pendingText;
      resetPending();
      void options.dispatch(text);
    },

    cancel: resetPending,

    /** @returns {string} */
    text() {
      return pendingText;
    },

    /** @returns {boolean} */
    hasPending() {
      return Boolean(pendingText);
    },
  };
}
