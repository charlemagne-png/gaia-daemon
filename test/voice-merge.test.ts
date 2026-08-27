import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceTranscriptMerger, MERGE_WINDOW_MS } from "../web/src/voice-merge.js";

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id: unknown) {
      timers.delete(Number(id));
    },
    advance(ms: number) {
      now += ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) return;
        timers.delete(due[0]);
        due[1].fn();
      }
    },
  };
}

test("GaiaVoice merge window joins transcripts across a thinking pause", () => {
  const clock = fakeTimers();
  const dispatched: string[] = [];
  const merger = createVoiceTranscriptMerger({ dispatch: (text) => dispatched.push(text), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });

  merger.accept("Yo, I have this voice agent, but");
  clock.advance(MERGE_WINDOW_MS - 1);
  assert.deepEqual(dispatched, []);

  merger.segmentStarted();
  clock.advance(50);
  assert.deepEqual(dispatched, []);

  merger.accept("it keeps clipping.");
  clock.advance(MERGE_WINDOW_MS);
  assert.deepEqual(dispatched, ["Yo, I have this voice agent, but it keeps clipping."]);
});

test("GaiaVoice manual mode accumulates until Go sends", () => {
  const clock = fakeTimers();
  const dispatched: string[] = [];
  const drafts: string[] = [];
  const merger = createVoiceTranscriptMerger({
    autoDispatch: false,
    dispatch: (text) => dispatched.push(text),
    onChange: (text) => drafts.push(text),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });

  merger.accept("first part");
  clock.advance(MERGE_WINDOW_MS * 4);
  assert.deepEqual(dispatched, []);
  assert.equal(merger.text(), "first part");

  merger.segmentStarted();
  merger.accept("second part");
  assert.equal(merger.text(), "first part second part");

  merger.send();
  assert.deepEqual(dispatched, ["first part second part"]);
  assert.equal(merger.text(), "");
  assert.deepEqual(drafts.at(-1), "");
});

test("GaiaVoice cap-chopped transcript never dispatches before continuation", () => {
  const clock = fakeTimers();
  const dispatched: string[] = [];
  const merger = createVoiceTranscriptMerger({ dispatch: (text) => dispatched.push(text), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });

  merger.accept("this segment hit the ten second cap", { mustMergeNext: true });
  clock.advance(MERGE_WINDOW_MS * 4);
  assert.deepEqual(dispatched, []);

  merger.segmentStarted();
  merger.accept("and this is the continuation");
  clock.advance(MERGE_WINDOW_MS);
  assert.deepEqual(dispatched, ["this segment hit the ten second cap and this is the continuation"]);
});
