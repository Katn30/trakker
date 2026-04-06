import { describe, it, expect } from "vitest";
import { TrackedObject } from "../src/TrackedObject";
import { Tracker } from "../src/Tracker";
import { Tracked } from "../src/Tracked";
import { TrackedCollection } from "../src/TrackedCollection";

// ---- Models ----

class PersonModel extends TrackedObject {
  @Tracked()
  accessor firstName: string = "";

  @Tracked()
  accessor lastName: string = "";

  @Tracked((_, v: string) => (!v ? "Email is required" : undefined))
  accessor email: string = "";

  constructor(tracker: Tracker) {
    super(tracker);
  }
}

class OrderModel extends TrackedObject {
  @Tracked()
  accessor status: string = "";

  readonly lines: TrackedCollection<string>;

  constructor(tracker: Tracker) {
    super(tracker);
    this.lines = new TrackedCollection<string>(tracker);
  }
}

// ---- endComposing ----

describe("Tracker – endComposing", () => {
  it("merges multiple property changes into one undo step", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    tracker.startComposing();
    person.firstName = "Alice";
    person.lastName = "Smith";
    person.email = "alice@example.com";
    tracker.endComposing();

    expect(tracker.canUndo).toBe(true);

    tracker.undo();

    expect(person.firstName).toBe("");
    expect(person.lastName).toBe("");
    expect(person.email).toBe("");
    expect(tracker.canUndo).toBe(false);
  });

  it("produces exactly one undo step regardless of how many changes were made", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    tracker.startComposing();
    person.firstName = "A";
    person.lastName = "B";
    person.email = "c@d.com";
    tracker.endComposing();

    tracker.undo();
    expect(tracker.canUndo).toBe(false);
  });

  it("redo after undo restores all coalesced changes", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    tracker.startComposing();
    person.firstName = "Alice";
    person.lastName = "Smith";
    tracker.endComposing();

    tracker.undo();
    tracker.redo();

    expect(person.firstName).toBe("Alice");
    expect(person.lastName).toBe("Smith");
  });

  it("changes before startComposing remain as separate undo steps", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    person.email = "before@example.com";

    tracker.startComposing();
    person.firstName = "Alice";
    person.lastName = "Smith";
    tracker.endComposing();

    tracker.undo(); // reverts firstName + lastName together
    expect(person.firstName).toBe("");
    expect(person.lastName).toBe("");
    expect(person.email).toBe("before@example.com");
    expect(tracker.canUndo).toBe(true);

    tracker.undo(); // reverts the earlier email change
    expect(person.email).toBe("");
    expect(tracker.canUndo).toBe(false);
  });

  it("handles a single change inside the composing window (no merge needed)", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    tracker.startComposing();
    person.firstName = "Alice";
    tracker.endComposing();

    tracker.undo();
    expect(person.firstName).toBe("");
    expect(tracker.canUndo).toBe(false);
  });

  it("with no changes inside the window, undo stack is unaffected", () => {
    const tracker = new Tracker();
    tracker.construct(() => new PersonModel(tracker));

    tracker.startComposing();
    tracker.endComposing();

    expect(tracker.canUndo).toBe(false);
  });

  it("works across multiple objects", () => {
    const tracker = new Tracker();
    const { person, order } = tracker.construct(() => ({
      person: new PersonModel(tracker),
      order: new OrderModel(tracker),
    }));

    tracker.startComposing();
    person.firstName = "Alice";
    order.status = "draft";
    tracker.endComposing();

    tracker.undo();

    expect(person.firstName).toBe("");
    expect(order.status).toBe("");
    expect(tracker.canUndo).toBe(false);
  });

  it("works with collection mutations", () => {
    const tracker = new Tracker();
    const order = tracker.construct(() => new OrderModel(tracker));

    tracker.startComposing();
    order.status = "draft";
    order.lines.push("line-1");
    order.lines.push("line-2");
    tracker.endComposing();

    tracker.undo();

    expect(order.status).toBe("");
    expect(order.lines.length).toBe(0);
    expect(tracker.canUndo).toBe(false);
  });

  it("second call to startComposing while already composing is a no-op", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    tracker.startComposing();
    person.firstName = "Alice";
    tracker.startComposing(); // no-op
    person.lastName = "Smith";
    tracker.endComposing();

    tracker.undo();

    expect(person.firstName).toBe("");
    expect(person.lastName).toBe("");
    expect(tracker.canUndo).toBe(false);
  });

  it("tracker is dirty after endComposing when changes were made", () => {
    const tracker = new Tracker();
    tracker.construct(() => new PersonModel(tracker));
    const person = tracker.trackedObjects[0] as PersonModel;

    tracker.startComposing();
    person.firstName = "Alice";
    tracker.endComposing();

    expect(tracker.isDirty).toBe(true);
  });

  it("calling endComposing when not composing is a no-op", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    person.firstName = "Alice";
    tracker.endComposing(); // not composing — should do nothing

    expect(tracker.canUndo).toBe(true);
    tracker.undo();
    expect(person.firstName).toBe("");
  });

  it("isDirty is preserved after endComposing with no changes when tracker was already dirty", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    person.firstName = "Alice"; // tracker is dirty

    tracker.startComposing();
    tracker.endComposing(); // no changes inside

    expect(tracker.isDirty).toBe(true);
    expect(tracker.canUndo).toBe(true);
  });

  it("single-change session: canRedo is false after endComposing when session undo cleared redo", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    tracker.startComposing();
    person.firstName = "Alice";
    tracker.undo(); // firstName undone → in redo; composed will have 0 ops, but this tests the single-op branch via a prior state
    person.lastName = "Smith"; // one op remains after undo clears redo
    tracker.endComposing(); // composed=[lastName op] — single op, redo should be empty

    expect(tracker.canRedo).toBe(false);
  });
});

// ---- undo/redo while composing is active ----

describe("Tracker – undo/redo during an active composing session", () => {
  it("undo works inside the session — undone change is excluded from the merged step", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    tracker.startComposing();
    person.firstName = "Alice";
    person.lastName = "Smith";
    tracker.undo(); // undo lastName — only firstName remains applied
    tracker.endComposing();

    expect(person.firstName).toBe("Alice");
    expect(person.lastName).toBe("");

    tracker.undo(); // reverts the merged step (only firstName)
    expect(person.firstName).toBe("");
    expect(tracker.canUndo).toBe(false);
  });

  it("endComposing discards redo entries generated inside the session", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    tracker.startComposing();
    person.firstName = "Alice";
    tracker.undo(); // firstName undone → sits in redo
    tracker.endComposing(); // session closed with no net changes

    // The redo entry from inside the session must not be accessible
    expect(tracker.canRedo).toBe(false);
  });

  it("rollbackComposing discards redo entries generated inside the session", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    tracker.startComposing();
    person.firstName = "Alice";
    tracker.undo(); // firstName undone → sits in redo
    tracker.rollbackComposing();

    // The redo entry from inside the session must not be accessible
    expect(tracker.canRedo).toBe(false);
    expect(person.firstName).toBe("");
  });

  it("pre-existing redo entries are preserved when the session makes no new writes", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    person.firstName = "Alice";
    tracker.undo(); // firstName in redo

    tracker.startComposing();
    // no writes inside
    tracker.endComposing();

    // pre-existing redo entry should still be there
    expect(tracker.canRedo).toBe(true);
    tracker.redo();
    expect(person.firstName).toBe("Alice");
  });
});

// ---- rollbackComposing ----

describe("Tracker – rollbackComposing", () => {
  it("reverts all changes made since startComposing", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    tracker.startComposing();
    person.firstName = "Alice";
    person.lastName = "Smith";
    person.email = "alice@example.com";
    tracker.rollbackComposing();

    expect(person.firstName).toBe("");
    expect(person.lastName).toBe("");
    expect(person.email).toBe("");
  });

  it("does not add any entry to the undo stack", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    tracker.startComposing();
    person.firstName = "Alice";
    tracker.rollbackComposing();

    expect(tracker.canUndo).toBe(false);
  });

  it("tracker is not dirty after rollbackComposing when it was clean before", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    tracker.startComposing();
    person.firstName = "Alice";
    tracker.rollbackComposing();

    expect(tracker.isDirty).toBe(false);
  });

  it("pre-existing undo steps are preserved after rollbackComposing", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    person.email = "before@example.com";

    tracker.startComposing();
    person.firstName = "Alice";
    person.lastName = "Smith";
    tracker.rollbackComposing();

    expect(person.firstName).toBe("");
    expect(person.lastName).toBe("");
    expect(person.email).toBe("before@example.com");
    expect(tracker.canUndo).toBe(true);

    tracker.undo();
    expect(person.email).toBe("");
  });

  it("calling rollbackComposing when not composing is a no-op", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    person.firstName = "Alice";
    tracker.rollbackComposing(); // not composing — should do nothing

    expect(person.firstName).toBe("Alice");
    expect(tracker.canUndo).toBe(true);
  });

  it("with no changes inside the window, rollback is a no-op", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    person.firstName = "Alice";

    tracker.startComposing();
    tracker.rollbackComposing();

    expect(person.firstName).toBe("Alice");
    expect(tracker.canUndo).toBe(true);
  });

  it("reverts collection mutations", () => {
    const tracker = new Tracker();
    const order = tracker.construct(() => new OrderModel(tracker));

    tracker.startComposing();
    order.status = "draft";
    order.lines.push("line-1");
    order.lines.push("line-2");
    tracker.rollbackComposing();

    expect(order.status).toBe("");
    expect(order.lines.length).toBe(0);
    expect(tracker.canUndo).toBe(false);
  });

  it("restores validation state after rollback", () => {
    const tracker = new Tracker();
    // Set the initial email during construction (suppressed) so the tracker starts clean.
    const person = tracker.construct(() => {
      const p = new PersonModel(tracker);
      p.email = "valid@example.com";
      return p;
    });
    expect(tracker.isValid).toBe(true);
    expect(tracker.canUndo).toBe(false);

    tracker.startComposing();
    person.email = ""; // makes invalid — first tracked write to this property
    expect(tracker.isValid).toBe(false);
    tracker.rollbackComposing();

    expect(person.email).toBe("valid@example.com");
    expect(tracker.isValid).toBe(true);
  });
});
