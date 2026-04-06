import { describe, it, expect } from "vitest";
import { State } from "../src/State";
import {
  applyStateTransition,
  StateTarget,
} from "../src/TrackedObjectStateMachine";

// ---- Mock StateTarget ----

class MockTarget implements StateTarget {
  idPlaceholder: number | null = null;
  id: number = 0; // simulates an @AutoId field

  state: State = State.Unchanged;
  private _dirtyCounter: number = 0;
  private _placeholderSeed = -1;

  _setState(s: State): void { this.state = s; }
  _getDirtyCounter(): number { return this._dirtyCounter; }
  _setDirtyCounter(v: number): void { this._dirtyCounter = v; }

  readonly tracker = { _nextPlaceholder: () => this._placeholderSeed-- };
}

function makeTarget(
  state: State,
  opts: { dirtyCounter?: number; idPlaceholder?: number | null; id?: number } = {},
): MockTarget {
  const t = new MockTarget();
  t._setState(state);
  t._setDirtyCounter(opts.dirtyCounter ?? 0);
  t.idPlaceholder = opts.idPlaceholder ?? null;
  t.id = opts.id ?? 0;
  return t;
}

// ---- added ----

describe("applyStateTransition — added / do", () => {
  it("transitions Unchanged → Insert", () => {
    const obj = makeTarget(State.Unchanged);
    applyStateTransition(obj, 'added', 'do');
    expect(obj.state).toBe(State.Insert);
  });

  it("assigns a negative placeholder", () => {
    const obj = makeTarget(State.Unchanged);
    applyStateTransition(obj, 'added', 'do');
    expect(obj.idPlaceholder).toBeLessThan(0);
  });

  it("each call assigns a distinct placeholder (redo always gets a fresh one)", () => {
    const obj = makeTarget(State.Unchanged);
    applyStateTransition(obj, 'added', 'do');
    const first = obj.idPlaceholder;

    applyStateTransition(obj, 'added', 'undo');
    applyStateTransition(obj, 'added', 'do'); // simulates redo
    expect(obj.idPlaceholder).not.toBe(first);
  });
});

describe("applyStateTransition — added / undo", () => {
  it("transitions Insert → Unchanged", () => {
    const obj = makeTarget(State.Insert, { idPlaceholder: -1 });
    applyStateTransition(obj, 'added', 'undo');
    expect(obj.state).toBe(State.Unchanged);
  });

  it("clears idPlaceholder", () => {
    const obj = makeTarget(State.Insert, { idPlaceholder: -1 });
    applyStateTransition(obj, 'added', 'undo');
    expect(obj.idPlaceholder).toBeNull();
  });
});

// ---- removed ----

describe("applyStateTransition — removed / do — from Insert", () => {
  it("collapses Insert → Unchanged", () => {
    const obj = makeTarget(State.Insert, { idPlaceholder: -1 });
    applyStateTransition(obj, 'removed', 'do');
    expect(obj.state).toBe(State.Unchanged);
  });

  it("clears idPlaceholder", () => {
    const obj = makeTarget(State.Insert, { idPlaceholder: -1 });
    applyStateTransition(obj, 'removed', 'do');
    expect(obj.idPlaceholder).toBeNull();
  });

  it("resets dirtyCounter to 0", () => {
    const obj = makeTarget(State.Insert, { idPlaceholder: -1, dirtyCounter: 2 });
    applyStateTransition(obj, 'removed', 'do');
    expect(obj._getDirtyCounter()).toBe(0);
  });
});

describe("applyStateTransition — removed / do — from Unchanged", () => {
  it("transitions Unchanged → Deleted", () => {
    const obj = makeTarget(State.Unchanged);
    applyStateTransition(obj, 'removed', 'do');
    expect(obj.state).toBe(State.Deleted);
  });

  it("does not touch idPlaceholder", () => {
    const obj = makeTarget(State.Unchanged);
    applyStateTransition(obj, 'removed', 'do');
    expect(obj.idPlaceholder).toBeNull();
  });

  it("does not touch dirtyCounter", () => {
    const obj = makeTarget(State.Unchanged, { dirtyCounter: 3 });
    applyStateTransition(obj, 'removed', 'do');
    expect(obj._getDirtyCounter()).toBe(3);
  });
});

describe("applyStateTransition — removed / undo — prevState Insert", () => {
  it("transitions to Insert", () => {
    const obj = makeTarget(State.Unchanged); // after a collapsed Insert→Unchanged
    applyStateTransition(obj, 'removed', 'undo', { prevState: State.Insert });
    expect(obj.state).toBe(State.Insert);
  });

  it("assigns a fresh placeholder", () => {
    const obj = makeTarget(State.Unchanged);
    applyStateTransition(obj, 'removed', 'undo', { prevState: State.Insert });
    expect(obj.idPlaceholder).toBeLessThan(0);
  });

  it("restores dirtyCounter from context", () => {
    const obj = makeTarget(State.Unchanged, { dirtyCounter: 0 });
    applyStateTransition(obj, 'removed', 'undo', { prevState: State.Insert, prevDirtyCounter: 2 });
    expect(obj._getDirtyCounter()).toBe(2);
  });
});

describe("applyStateTransition — removed / undo — prevState Unchanged", () => {
  it("transitions Deleted → Unchanged", () => {
    const obj = makeTarget(State.Deleted);
    applyStateTransition(obj, 'removed', 'undo', { prevState: State.Unchanged });
    expect(obj.state).toBe(State.Unchanged);
  });

  it("idPlaceholder stays null", () => {
    const obj = makeTarget(State.Deleted);
    applyStateTransition(obj, 'removed', 'undo', { prevState: State.Unchanged });
    expect(obj.idPlaceholder).toBeNull();
  });
});

// ---- committed ----

describe("applyStateTransition — committed / do — Insert with realId", () => {
  it("transitions Insert → Unchanged", () => {
    const obj = makeTarget(State.Insert, { idPlaceholder: -1 });
    applyStateTransition(obj, 'committed', 'do', { prevState: State.Insert, autoIdProp: 'id', realId: 42 });
    expect(obj.state).toBe(State.Unchanged);
  });

  it("writes realId to the @AutoId field", () => {
    const obj = makeTarget(State.Insert, { idPlaceholder: -1 });
    applyStateTransition(obj, 'committed', 'do', { prevState: State.Insert, autoIdProp: 'id', realId: 42 });
    expect(obj.id).toBe(42);
  });

  it("clears idPlaceholder", () => {
    const obj = makeTarget(State.Insert, { idPlaceholder: -1 });
    applyStateTransition(obj, 'committed', 'do', { prevState: State.Insert, autoIdProp: 'id', realId: 42 });
    expect(obj.idPlaceholder).toBeNull();
  });

  it("resets dirtyCounter", () => {
    const obj = makeTarget(State.Insert, { idPlaceholder: -1, dirtyCounter: 3 });
    applyStateTransition(obj, 'committed', 'do', { prevState: State.Insert, autoIdProp: 'id', realId: 42 });
    expect(obj._getDirtyCounter()).toBe(0);
  });
});

describe("applyStateTransition — committed / do — Insert without realId", () => {
  it("transitions Insert → Unchanged", () => {
    const obj = makeTarget(State.Insert, { idPlaceholder: -1 });
    applyStateTransition(obj, 'committed', 'do', { prevState: State.Insert });
    expect(obj.state).toBe(State.Unchanged);
  });

  it("does not touch @AutoId field when no realId is provided", () => {
    const obj = makeTarget(State.Insert, { idPlaceholder: -1, id: 0 });
    applyStateTransition(obj, 'committed', 'do', { prevState: State.Insert });
    expect(obj.id).toBe(0);
  });

  it("clears idPlaceholder", () => {
    const obj = makeTarget(State.Insert, { idPlaceholder: -1 });
    applyStateTransition(obj, 'committed', 'do', { prevState: State.Insert });
    expect(obj.idPlaceholder).toBeNull();
  });
});

describe("applyStateTransition — committed / do — Deleted", () => {
  it("transitions Deleted → Unchanged", () => {
    const obj = makeTarget(State.Deleted);
    applyStateTransition(obj, 'committed', 'do', { prevState: State.Deleted });
    expect(obj.state).toBe(State.Unchanged);
  });

  it("resets dirtyCounter", () => {
    const obj = makeTarget(State.Deleted, { dirtyCounter: 1 });
    applyStateTransition(obj, 'committed', 'do', { prevState: State.Deleted });
    expect(obj._getDirtyCounter()).toBe(0);
  });

  it("does not touch @AutoId field", () => {
    const obj = makeTarget(State.Deleted, { id: 10 });
    applyStateTransition(obj, 'committed', 'do', { prevState: State.Deleted });
    expect(obj.id).toBe(10);
  });
});

describe("applyStateTransition — committed / do — Unchanged (Changed)", () => {
  it("state remains Unchanged", () => {
    const obj = makeTarget(State.Unchanged, { dirtyCounter: 2 });
    applyStateTransition(obj, 'committed', 'do', { prevState: State.Unchanged });
    expect(obj.state).toBe(State.Unchanged);
  });

  it("resets dirtyCounter", () => {
    const obj = makeTarget(State.Unchanged, { dirtyCounter: 2 });
    applyStateTransition(obj, 'committed', 'do', { prevState: State.Unchanged });
    expect(obj._getDirtyCounter()).toBe(0);
  });
});

describe("applyStateTransition — committed / undo — prevState Insert", () => {
  it("transitions Unchanged → Deleted", () => {
    const obj = makeTarget(State.Unchanged, { id: 42 });
    applyStateTransition(obj, 'committed', 'undo', { prevState: State.Insert });
    expect(obj.state).toBe(State.Deleted);
  });

  it("preserves @AutoId (real id kept for DELETE request)", () => {
    const obj = makeTarget(State.Unchanged, { id: 42 });
    applyStateTransition(obj, 'committed', 'undo', { prevState: State.Insert });
    expect(obj.id).toBe(42);
  });

  it("idPlaceholder stays null", () => {
    const obj = makeTarget(State.Unchanged, { id: 42 });
    applyStateTransition(obj, 'committed', 'undo', { prevState: State.Insert });
    expect(obj.idPlaceholder).toBeNull();
  });
});

describe("applyStateTransition — committed / undo — prevState Deleted", () => {
  it("transitions Unchanged → Insert", () => {
    const obj = makeTarget(State.Unchanged);
    applyStateTransition(obj, 'committed', 'undo', { prevState: State.Deleted });
    expect(obj.state).toBe(State.Insert);
  });

  it("assigns a fresh placeholder", () => {
    const obj = makeTarget(State.Unchanged);
    applyStateTransition(obj, 'committed', 'undo', { prevState: State.Deleted });
    expect(obj.idPlaceholder).toBeLessThan(0);
  });
});

describe("applyStateTransition — committed / undo — prevState Unchanged", () => {
  it("state remains Unchanged", () => {
    const obj = makeTarget(State.Unchanged, { dirtyCounter: 0 });
    applyStateTransition(obj, 'committed', 'undo', { prevState: State.Unchanged });
    expect(obj.state).toBe(State.Unchanged);
  });

  it("does not touch idPlaceholder", () => {
    const obj = makeTarget(State.Unchanged);
    applyStateTransition(obj, 'committed', 'undo', { prevState: State.Unchanged });
    expect(obj.idPlaceholder).toBeNull();
  });
});

describe("applyStateTransition — committed / undo — prevState Changed", () => {
  it("transitions Unchanged → Changed", () => {
    const obj = makeTarget(State.Unchanged);
    applyStateTransition(obj, 'committed', 'undo', { prevState: State.Changed });
    expect(obj.state).toBe(State.Changed);
  });

  it("does not touch idPlaceholder", () => {
    const obj = makeTarget(State.Unchanged);
    applyStateTransition(obj, 'committed', 'undo', { prevState: State.Changed });
    expect(obj.idPlaceholder).toBeNull();
  });
});
