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

  function clearHoldTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function resetPending() {
    clearHoldTimer();
    pendingText = "";
    waitingForContinuation = false;
    mustMergeNext = false;
  }

  function scheduleHold() {
    clearHoldTimer();
    if (!pendingText || waitingForContinuation || mustMergeNext) return;
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
      scheduleHold();
    },

    /** Dispatch any non-cap-held text now; cap-held text still obeys never-alone. */
    flushReady() {
      if (!pendingText || waitingForContinuation || mustMergeNext) return;
      const text = pendingText;
      resetPending();
      void options.dispatch(text);
    },

    cancel: resetPending,

    /** @returns {boolean} */
    hasPending() {
      return Boolean(pendingText);
    },
  };
}
