import { State } from "./State";
import { IdAssignment } from "./ExternallyAssigned";

export type StateEvent = 'added' | 'removed' | 'committed';
export type StateDirection = 'do' | 'undo';

export interface StateContext {
  prevState?: State;
  prevDirtyCounter?: number;
  autoIdProp?: string;
  realId?: number;
}

export interface StateTarget {
  idPlaceholder: number | null;
  state: State;
  _setState(value: State): void;
  _getDirtyCounter(): number;
  _setDirtyCounter(value: number): void;
  readonly tracker: { _nextPlaceholder(): number };
}

export function applyStateTransition(
  obj: StateTarget,
  event: StateEvent,
  direction: StateDirection,
  context?: StateContext,
): void {
  if (event === 'added') {
    applyAdded(obj, direction);
  } else if (event === 'removed') {
    applyRemoved(obj, direction, context);
  } else {
    applyCommitted(obj, direction, context);
  }
}

function applyAdded(obj: StateTarget, direction: StateDirection): void {
  if (direction === 'undo') {
    obj._setState(State.Unchanged);
    obj.idPlaceholder = null;
  } else {
    obj._setState(State.Insert);
    obj.idPlaceholder = obj.tracker._nextPlaceholder();
  }
}

function applyRemoved(obj: StateTarget, direction: StateDirection, context?: StateContext): void {
  if (direction === 'undo') {
    const prev = context?.prevState ?? State.Unchanged;
    obj._setState(prev);
    if (prev === State.Insert) {
      obj.idPlaceholder = obj.tracker._nextPlaceholder();
      if (context?.prevDirtyCounter !== undefined) {
        obj._setDirtyCounter(context.prevDirtyCounter);
      }
    } else {
      obj.idPlaceholder = null;
    }
  } else {
    if (obj.state === State.Insert) {
      obj._setState(State.Unchanged);
      obj.idPlaceholder = null;
      obj._setDirtyCounter(0);
    } else {
      obj._setState(State.Deleted);
    }
  }
}

function applyCommitted(obj: StateTarget, direction: StateDirection, context?: StateContext): void {
  if (direction === 'undo') {
    const prev = context?.prevState ?? State.Unchanged;
    if (prev === State.Insert) {
      // committed insert was undone: item now exists on server → mark Deleted so save layer sends DELETE
      obj._setState(State.Deleted);
      obj.idPlaceholder = null;
      // @AutoId keeps the real server id — needed for the DELETE request
    } else if (prev === State.Deleted) {
      // committed delete was undone: re-insert needed → assign fresh placeholder
      obj._setState(State.Insert);
      obj.idPlaceholder = obj.tracker._nextPlaceholder();
    } else if (prev === State.Changed) {
      // committed update was undone: property undo closures restore values and dirtyCounter
      obj._setState(State.Changed);
    }
    // prevState=Unchanged: no state change needed
  } else {
    if (context?.prevState === State.Insert && context.autoIdProp && context.realId !== undefined) {
      (obj as any)[context.autoIdProp] = context.realId;
    }
    obj.idPlaceholder = null;
    obj._setState(State.Unchanged);
    obj._setDirtyCounter(0);
  }
}

export function buildCommittedContext(
  obj: StateTarget & { [key: string]: any },
  autoIdProp: string | undefined,
  keys: IdAssignment[] | undefined,
): StateContext {
  const prevState = obj.state;
  let realId: number | undefined;
  if (prevState === State.Insert && obj.idPlaceholder !== null && keys) {
    realId = keys.find((k) => k.placeholder === obj.idPlaceholder)?.value;
  }
  return { prevState, autoIdProp, realId };
}
