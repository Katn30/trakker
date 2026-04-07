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

// ---- session.end() ----

describe("Tracker – session.end()", () => {
  it("merges multiple property changes into one undo step", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    const session = tracker.startSession();
    person.firstName = "Alice";
    person.lastName = "Smith";
    person.email = "alice@example.com";
    session.end();

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

    const session = tracker.startSession();
    person.firstName = "A";
    person.lastName = "B";
    person.email = "c@d.com";
    session.end();

    tracker.undo();
    expect(tracker.canUndo).toBe(false);
  });

  it("redo after undo restores all coalesced changes", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    const session = tracker.startSession();
    person.firstName = "Alice";
    person.lastName = "Smith";
    session.end();

    tracker.undo();
    tracker.redo();

    expect(person.firstName).toBe("Alice");
    expect(person.lastName).toBe("Smith");
  });

  it("changes before startComposing remain as separate undo steps", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    person.email = "before@example.com";

    const session = tracker.startSession();
    person.firstName = "Alice";
    person.lastName = "Smith";
    session.end();

    tracker.undo(); // reverts firstName + lastName together
    expect(person.firstName).toBe("");
    expect(person.lastName).toBe("");
    expect(person.email).toBe("before@example.com");
    expect(tracker.canUndo).toBe(true);

    tracker.undo(); // reverts the earlier email change
    expect(person.email).toBe("");
    expect(tracker.canUndo).toBe(false);
  });

  it("handles a single change inside the session window (no merge needed)", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    const session = tracker.startSession();
    person.firstName = "Alice";
    session.end();

    tracker.undo();
    expect(person.firstName).toBe("");
    expect(tracker.canUndo).toBe(false);
  });

  it("with no changes inside the window, undo stack is unaffected", () => {
    const tracker = new Tracker();
    tracker.construct(() => new PersonModel(tracker));

    const session = tracker.startSession();
    session.end();

    expect(tracker.canUndo).toBe(false);
  });

  it("works across multiple objects", () => {
    const tracker = new Tracker();
    const { person, order } = tracker.construct(() => ({
      person: new PersonModel(tracker),
      order: new OrderModel(tracker),
    }));

    const session = tracker.startSession();
    person.firstName = "Alice";
    order.status = "draft";
    session.end();

    tracker.undo();

    expect(person.firstName).toBe("");
    expect(order.status).toBe("");
    expect(tracker.canUndo).toBe(false);
  });

  it("works with collection mutations", () => {
    const tracker = new Tracker();
    const order = tracker.construct(() => new OrderModel(tracker));

    const session = tracker.startSession();
    order.status = "draft";
    order.lines.push("line-1");
    order.lines.push("line-2");
    session.end();

    tracker.undo();

    expect(order.status).toBe("");
    expect(order.lines.length).toBe(0);
    expect(tracker.canUndo).toBe(false);
  });

  it("second call to startSession while a session is active returns the same session", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    const session = tracker.startSession();
    person.firstName = "Alice";
    const session2 = tracker.startSession(); // no-op — returns same session
    expect(session2).toBe(session);
    person.lastName = "Smith";
    session.end();

    tracker.undo();

    expect(person.firstName).toBe("");
    expect(person.lastName).toBe("");
    expect(tracker.canUndo).toBe(false);
  });

  it("tracker is dirty after session.end() when changes were made", () => {
    const tracker = new Tracker();
    tracker.construct(() => new PersonModel(tracker));
    const person = tracker.trackedObjects[0] as PersonModel;

    const session = tracker.startSession();
    person.firstName = "Alice";
    session.end();

    expect(tracker.isDirty).toBe(true);
  });

  it("isDirty is preserved after session.end() with no changes when tracker was already dirty", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    person.firstName = "Alice"; // tracker is dirty

    const session = tracker.startSession();
    session.end(); // no changes inside

    expect(tracker.isDirty).toBe(true);
    expect(tracker.canUndo).toBe(true);
  });

  it("single-change session: canRedo is false after session.end() when session undo cleared redo", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    const session = tracker.startSession();
    person.firstName = "Alice";
    tracker.undo(); // firstName undone → in redo; composed will have 0 ops, but this tests the single-op branch via a prior state
    person.lastName = "Smith"; // one op remains after undo clears redo
    session.end(); // composed=[lastName op] — single op, redo should be empty

    expect(tracker.canRedo).toBe(false);
  });
});

// ---- undo/redo while composing is active ----

describe("Tracker – undo/redo during an active composing session", () => {
  it("undo works inside the session — undone change is excluded from the merged step", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    const session = tracker.startSession();
    person.firstName = "Alice";
    person.lastName = "Smith";
    tracker.undo(); // undo lastName — only firstName remains applied
    session.end();

    expect(person.firstName).toBe("Alice");
    expect(person.lastName).toBe("");

    tracker.undo(); // reverts the merged step (only firstName)
    expect(person.firstName).toBe("");
    expect(tracker.canUndo).toBe(false);
  });

  it("session.end() discards redo entries generated inside the session", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    const session = tracker.startSession();
    person.firstName = "Alice";
    tracker.undo(); // firstName undone → sits in redo
    session.end(); // session closed with no net changes

    // The redo entry from inside the session must not be accessible
    expect(tracker.canRedo).toBe(false);
  });

  it("session.rollback() discards redo entries generated inside the session", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    const session = tracker.startSession();
    person.firstName = "Alice";
    tracker.undo(); // firstName undone → sits in redo
    session.rollback();

    // The redo entry from inside the session must not be accessible
    expect(tracker.canRedo).toBe(false);
    expect(person.firstName).toBe("");
  });

  it("pre-existing redo entries are preserved when the session makes no new writes", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    person.firstName = "Alice";
    tracker.undo(); // firstName in redo

    const session = tracker.startSession();
    // no writes inside
    session.end();

    // pre-existing redo entry should still be there
    expect(tracker.canRedo).toBe(true);
    tracker.redo();
    expect(person.firstName).toBe("Alice");
  });
});

// ---- session.rollback() ----

describe("Tracker – session.rollback()", () => {
  it("reverts all changes made since startComposing", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    const session = tracker.startSession();
    person.firstName = "Alice";
    person.lastName = "Smith";
    person.email = "alice@example.com";
    session.rollback();

    expect(person.firstName).toBe("");
    expect(person.lastName).toBe("");
    expect(person.email).toBe("");
  });

  it("does not add any entry to the undo stack", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    const session = tracker.startSession();
    person.firstName = "Alice";
    session.rollback();

    expect(tracker.canUndo).toBe(false);
  });

  it("tracker is not dirty after session.rollback() when it was clean before", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    const session = tracker.startSession();
    person.firstName = "Alice";
    session.rollback();

    expect(tracker.isDirty).toBe(false);
  });

  it("pre-existing undo steps are preserved after session.rollback()", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    person.email = "before@example.com";

    const session = tracker.startSession();
    person.firstName = "Alice";
    person.lastName = "Smith";
    session.rollback();

    expect(person.firstName).toBe("");
    expect(person.lastName).toBe("");
    expect(person.email).toBe("before@example.com");
    expect(tracker.canUndo).toBe(true);

    tracker.undo();
    expect(person.email).toBe("");
  });

  it("with no changes inside the window, rollback is a no-op", () => {
    const tracker = new Tracker();
    const person = tracker.construct(() => new PersonModel(tracker));

    person.firstName = "Alice";

    const session = tracker.startSession();
    session.rollback();

    expect(person.firstName).toBe("Alice");
    expect(tracker.canUndo).toBe(true);
  });

  it("reverts collection mutations", () => {
    const tracker = new Tracker();
    const order = tracker.construct(() => new OrderModel(tracker));

    const session = tracker.startSession();
    order.status = "draft";
    order.lines.push("line-1");
    order.lines.push("line-2");
    session.rollback();

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

    const session = tracker.startSession();
    person.email = ""; // makes invalid — first tracked write to this property
    expect(tracker.isValid).toBe(false);
    session.rollback();

    expect(person.email).toBe("valid@example.com");
    expect(tracker.isValid).toBe(true);
  });
});
