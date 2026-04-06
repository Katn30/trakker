/**
 * Commit lifecycle and save-layer correctness tests.
 *
 * Covers every reachable combination of user actions (add, remove, edit,
 * undo, redo, commit) and verifies both the resulting State and that
 * the save layer can determine the correct server operation and ID:
 *
 *   obj.state          → which operation (Insert/Changed/Deleted/Unchanged)
 *   obj.idPlaceholder  → temp ID to use for Insert items (POST)
 *   obj.id             → real server ID to use for Changed/Deleted items (PUT/DELETE)
 *
 * Key invariants:
 *   Insert    → POST  using idPlaceholder  (obj.id may hold a stale real server id)
 *   Changed   → PUT   using obj.id         (always a real server id > 0)
 *   Deleted   → DELETE using obj.id        (always a real server id > 0)
 *   Unchanged → skip
 */

import { describe, it, expect } from "vitest";
import { TrackedObject } from "../src/TrackedObject";
import { State } from "../src/State";
import { Tracker } from "../src/Tracker";
import { Tracked } from "../src/Tracked";
import { TrackedCollection } from "../src/TrackedCollection";
import { AutoId } from "../src/ExternallyAssigned";

class ItemModel extends TrackedObject {
  @AutoId
  id: number = 0;

  @Tracked()
  accessor name: string = "";

  constructor(tracker: Tracker) {
    super(tracker);
  }
}

/** Creates an already-persisted item (state=Unchanged, id=realId). */
function loadedItem(tracker: Tracker, realId: number): ItemModel {
  const item = tracker.construct(() => new ItemModel(tracker));
  tracker.withTrackingSuppressed(() => { item.id = realId; });
  return item;
}

// ---- Insert ----

describe("TrackedObject state transitions — Insert", () => {
  it("new item added to collection: state=Insert, idPlaceholder<0", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item);

    expect(item.state).toBe(State.Insert);
    expect(item.idPlaceholder).not.toBeNull();
    expect(item.idPlaceholder).toBeLessThan(0);
  });

  it("Insert: save layer should use idPlaceholder, not the @AutoId field", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item);

    expect(item.state).toBe(State.Insert);
    expect(item.id).toBe(0); // untouched by the library
    expect(item.idPlaceholder).toBeLessThan(0);
  });

  it("undo push → state=Unchanged, idPlaceholder=null → skip", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item);
    tracker.undo();

    expect(item.state).toBe(State.Unchanged);
    expect(item.idPlaceholder).toBeNull();
  });

  it("undo push → redo push → state=Insert, fresh idPlaceholder<0 → POST", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item);
    const firstPh = item.idPlaceholder!;

    tracker.undo();
    tracker.redo();

    expect(item.state).toBe(State.Insert);
    expect(item.idPlaceholder).toBeLessThan(0);
    expect(item.idPlaceholder).not.toBe(firstPh); // fresh placeholder on redo
  });

  it("undo before commit clears idPlaceholder; redo assigns a fresh one usable for commit", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item);
    const firstPlaceholder = item.idPlaceholder!;

    tracker.undo();
    expect(item.idPlaceholder).toBeNull();

    tracker.redo();
    expect(item.idPlaceholder).not.toBeNull();
    expect(item.idPlaceholder).not.toBe(firstPlaceholder);

    tracker.onCommit([{ placeholder: item.idPlaceholder!, value: 1 }]);
    expect(item.state).toBe(State.Unchanged);
    expect(item.id).toBe(1);
  });

  it("multiple undo/redo cycles remain coherent", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item);

    tracker.onCommit([{ placeholder: item.idPlaceholder!, value: 1 }]);

    tracker.undo();
    expect(item.state).toBe(State.Deleted);
    tracker.redo();
    expect(item.state).toBe(State.Unchanged);
    tracker.undo();
    expect(item.state).toBe(State.Deleted);
    tracker.redo();
    expect(item.state).toBe(State.Unchanged);
  });

  it("push + name → commit → undo → undo exhausts the undo stack", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item);
    item.name = "Widget"; // two user operations total

    tracker.onCommit([{ placeholder: item.idPlaceholder!, value: 1 }]);

    tracker.undo(); // undoes name + committed state → Deleted
    expect(item.state).toBe(State.Deleted);

    tracker.undo(); // undoes push → state=Unchanged (added/undo), dirtyCounter=-1 but no longer drives state
    expect(item.state).toBe(State.Unchanged);
    expect(tracker.canUndo).toBe(false);
  });

  it("onCommit does not add a spurious extra undo step", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item); // single user operation

    tracker.onCommit([{ placeholder: item.idPlaceholder!, value: 1 }]);

    tracker.undo();
    expect(tracker.canUndo).toBe(false);
    expect(item.state).toBe(State.Deleted);
  });
});

// ---- Committed Insert undone ----

describe("TrackedObject state transitions — committed Insert undone", () => {
  it("push → commit(id=1) → state=Unchanged → skip", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item);
    tracker.onCommit([{ placeholder: item.idPlaceholder!, value: 1 }]);

    expect(item.state).toBe(State.Unchanged);
    expect(item.id).toBe(1);
    expect(item.idPlaceholder).toBeNull();
  });

  it("push → commit(id=1) → undo: state=Deleted, id=1, idPlaceholder=null → DELETE with id=1", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item);
    tracker.onCommit([{ placeholder: item.idPlaceholder!, value: 1 }]);
    tracker.undo();

    expect(item.state).toBe(State.Deleted);
    expect(item.id).toBe(1); // real id — use for DELETE
    expect(item.idPlaceholder).toBeNull();
  });

  it("push → commit(id=1) → undo → redo: state=Unchanged → skip", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item);
    tracker.onCommit([{ placeholder: item.idPlaceholder!, value: 1 }]);
    tracker.undo();
    tracker.redo();

    expect(item.state).toBe(State.Unchanged);
    expect(item.id).toBe(1);
    expect(item.idPlaceholder).toBeNull();
  });
});

// ---- Changed ----

describe("TrackedObject state transitions — Changed", () => {
  it("loaded item edited: state=Changed, id=real, idPlaceholder=null → PUT with id", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    item.name = "Widget";

    expect(item.state).toBe(State.Changed);
    expect(item.id).toBe(10);
    expect(item.idPlaceholder).toBeNull();
  });

  it("edit → undo → state=Unchanged → skip", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    item.name = "Widget";
    tracker.undo();

    expect(item.state).toBe(State.Unchanged);
    expect(item.id).toBe(10);
    expect(item.idPlaceholder).toBeNull();
  });

  it("edit → undo → redo → state=Changed, id=10, idPlaceholder=null → PUT with id", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    item.name = "Widget";
    tracker.undo();
    tracker.redo();

    expect(item.state).toBe(State.Changed);
    expect(item.id).toBe(10);
    expect(item.idPlaceholder).toBeNull();
  });

  it("undo before commit discards change; redo restores it and commit succeeds", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    item.name = "Widget";

    tracker.undo();
    expect(item.state).toBe(State.Unchanged);
    expect(item.name).toBe("");

    tracker.redo();
    expect(item.state).toBe(State.Changed);
    expect(item.name).toBe("Widget");

    tracker.onCommit();
    expect(item.state).toBe(State.Unchanged);
  });

  it("edit → commit → state=Unchanged → skip", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    item.name = "Widget";
    tracker.onCommit();

    expect(item.state).toBe(State.Unchanged);
    expect(item.id).toBe(10);
    expect(item.idPlaceholder).toBeNull();
  });

  it("edit → commit → undo → state=Changed, id=10, pre-edit values restored → PUT with id", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    item.name = "Widget";
    tracker.onCommit();
    tracker.undo();

    expect(item.state).toBe(State.Changed);
    expect(item.name).toBe(""); // pre-edit value restored
    expect(item.id).toBe(10);
    expect(item.idPlaceholder).toBeNull();
  });

  it("edit → commit → undo → redo → state=Unchanged → skip", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    item.name = "Widget";
    tracker.onCommit();
    tracker.undo();
    tracker.redo();

    expect(item.state).toBe(State.Unchanged);
    expect(item.name).toBe("Widget");
    expect(item.id).toBe(10);
    expect(item.idPlaceholder).toBeNull();
  });
});

// ---- Deleted ----

describe("TrackedObject state transitions — Deleted", () => {
  it("loaded item removed: state=Deleted, id=real, idPlaceholder=null → DELETE with id", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    const coll = new TrackedCollection<ItemModel>(tracker, [item]);
    coll.remove(item);

    expect(item.state).toBe(State.Deleted);
    expect(item.id).toBe(10);
    expect(item.idPlaceholder).toBeNull();
  });

  it("remove → undo → state=Unchanged → skip", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    const coll = new TrackedCollection<ItemModel>(tracker, [item]);
    coll.remove(item);
    tracker.undo();

    expect(item.state).toBe(State.Unchanged);
    expect(item.id).toBe(10);
    expect(item.idPlaceholder).toBeNull();
  });

  it("remove → undo → redo → state=Deleted, id=10, idPlaceholder=null → DELETE with id", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    const coll = new TrackedCollection<ItemModel>(tracker, [item]);
    coll.remove(item);
    tracker.undo();
    tracker.redo();

    expect(item.state).toBe(State.Deleted);
    expect(item.id).toBe(10);
    expect(item.idPlaceholder).toBeNull();
  });

  it("undo before commit clears Deleted; redo restores it and commit succeeds", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    const coll = new TrackedCollection<ItemModel>(tracker, [item]);
    coll.remove(item);

    tracker.undo();
    expect(item.state).toBe(State.Unchanged);

    tracker.redo();
    expect(item.state).toBe(State.Deleted);

    tracker.onCommit();
    expect(item.state).toBe(State.Unchanged);
  });

  it("remove → commit → state=Unchanged → skip", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    const coll = new TrackedCollection<ItemModel>(tracker, [item]);
    coll.remove(item);
    tracker.onCommit();

    expect(item.state).toBe(State.Unchanged);
    expect(item.id).toBe(10);
    expect(item.idPlaceholder).toBeNull();
  });

  it("remove → commit → undo: state=Insert, idPlaceholder<0 — save layer must POST using idPlaceholder, NOT the stale id", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    const coll = new TrackedCollection<ItemModel>(tracker, [item]);
    coll.remove(item);
    tracker.onCommit();
    tracker.undo();

    // Critical: @AutoId still holds real server id (10), but the item needs
    // a new INSERT. The save layer MUST use idPlaceholder, not item.id.
    expect(item.state).toBe(State.Insert);
    expect(item.idPlaceholder).not.toBeNull();
    expect(item.idPlaceholder).toBeLessThan(0);
    expect(item.id).toBe(10); // stale — do NOT use for INSERT
  });

  it("committed delete → undo (Insert with fresh placeholder) → commit again re-inserts the item", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    const coll = new TrackedCollection<ItemModel>(tracker, [item]);
    coll.remove(item);
    tracker.onCommit();
    expect(item.state).toBe(State.Unchanged);

    tracker.undo();
    expect(item.state).toBe(State.Insert);
    expect(item.idPlaceholder).toBeLessThan(0);

    tracker.onCommit([{ placeholder: item.idPlaceholder!, value: 99 }]);
    expect(item.state).toBe(State.Unchanged);
    expect(item.id).toBe(99);
  });

  it("remove → commit → undo → redo → state=Unchanged → skip", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 10);
    const coll = new TrackedCollection<ItemModel>(tracker, [item]);
    coll.remove(item);
    tracker.onCommit();
    tracker.undo();
    tracker.redo();

    expect(item.state).toBe(State.Unchanged);
    expect(item.id).toBe(10);
    expect(item.idPlaceholder).toBeNull();
  });
});

// ---- Insert collapsed by remove ----

describe("TrackedObject state transitions — Insert collapsed by remove", () => {
  it("push → remove → state=Unchanged → skip (item was never persisted)", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item);
    items.remove(item);

    expect(item.state).toBe(State.Unchanged);
    expect(item.idPlaceholder).toBeNull();
  });
});

// ---- @AutoId / idPlaceholder ----

describe("TrackedObject state transitions — @AutoId / idPlaceholder", () => {
  it("assigns distinct placeholders to multiple new items", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const i1 = tracker.construct(() => new ItemModel(tracker));
    const i2 = tracker.construct(() => new ItemModel(tracker));
    items.push(i1);
    items.push(i2);

    expect(i1.idPlaceholder).not.toBeNull();
    expect(i2.idPlaceholder).not.toBeNull();
    expect(i1.idPlaceholder).not.toBe(i2.idPlaceholder);
  });

  it("item with an existing positive id has no placeholder", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 42);

    expect(item.idPlaceholder).toBeNull();
  });

  it("onCommit marks tracker as not dirty", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item);
    item.name = "Widget";
    tracker.onCommit([]);

    expect(tracker.isDirty).toBe(false);
  });

  it("leaves @AutoId unchanged when placeholder not found in keys", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item);
    tracker.onCommit([{ placeholder: -999, value: 101 }]);

    expect(item.id).toBe(0); // not matched → unchanged
    expect(item.idPlaceholder).toBeNull(); // still cleared by state machine
  });

  it("idPlaceholder is globally unique across save cycles", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const i1 = tracker.construct(() => new ItemModel(tracker));
    items.push(i1);
    const ph1 = i1.idPlaceholder!;
    tracker.onCommit([{ placeholder: ph1, value: 1 }]);

    const i2 = tracker.construct(() => new ItemModel(tracker));
    items.push(i2);

    expect(i2.idPlaceholder).not.toBeNull();
    expect(i2.idPlaceholder).toBeLessThan(0);
    expect(i2.idPlaceholder).not.toBe(ph1);
  });

  it("@AutoId field is never written with a non-server value by the library", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));

    items.push(item);
    expect(item.id).toBe(0); // placeholder assigned but @AutoId untouched

    tracker.undo();
    expect(item.id).toBe(0); // @AutoId still untouched

    tracker.redo();
    expect(item.id).toBe(0); // @AutoId still untouched

    tracker.onCommit([{ placeholder: item.idPlaceholder!, value: 42 }]);
    expect(item.id).toBe(42); // only now does the library write to @AutoId

    tracker.undo();
    expect(item.id).toBe(42); // real id kept — never zeroed out
  });
});

// ---- Save operation routing ----

describe("TrackedObject state transitions — save operation routing", () => {
  /**
   * Mirrors the save loop a frontend would run over tracker.trackedObjects.
   */
  function whatToSave(item: ItemModel): { op: string; idToUse: number | null } {
    switch (item.state) {
      case State.Insert:   return { op: "POST",   idToUse: item.idPlaceholder };
      case State.Changed:  return { op: "PUT",    idToUse: item.id };
      case State.Deleted:  return { op: "DELETE", idToUse: item.id };
      default:                 return { op: "skip",   idToUse: null };
    }
  }

  it("new item → POST using idPlaceholder", () => {
    const tracker = new Tracker();
    const items = new TrackedCollection<ItemModel>(tracker);
    const item = tracker.construct(() => new ItemModel(tracker));
    items.push(item);

    const { op, idToUse } = whatToSave(item);
    expect(op).toBe("POST");
    expect(idToUse).toBeLessThan(0);
    expect(idToUse).toBe(item.idPlaceholder);
  });

  it("loaded + edited → PUT using real id", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 5);
    item.name = "Updated";

    const { op, idToUse } = whatToSave(item);
    expect(op).toBe("PUT");
    expect(idToUse).toBe(5);
  });

  it("loaded + removed → DELETE using real id", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 5);
    const coll = new TrackedCollection<ItemModel>(tracker, [item]);
    coll.remove(item);

    const { op, idToUse } = whatToSave(item);
    expect(op).toBe("DELETE");
    expect(idToUse).toBe(5);
  });

  it("committed delete → undo → POST using fresh idPlaceholder (NOT stale real id)", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 99);
    const coll = new TrackedCollection<ItemModel>(tracker, [item]);
    coll.remove(item);
    tracker.onCommit();
    tracker.undo();

    const { op, idToUse } = whatToSave(item);
    expect(op).toBe("POST");
    expect(idToUse).toBeLessThan(0); // fresh placeholder, never the stale 99
    expect(idToUse).not.toBe(99);
  });

  it("loaded item → skip (no operation needed)", () => {
    const tracker = new Tracker();
    const item = loadedItem(tracker, 5);

    const { op } = whatToSave(item);
    expect(op).toBe("skip");
  });
});
