import { TrackedObject } from "./TrackedObject";
import { State } from "./State";
import { ITrackerContext } from "./ITrackerContext";

export type PropertyScope = [TrackedObject, string[]];

export class TrackerSession implements ITrackerContext {
  private readonly _scope: Map<TrackedObject, Set<string>> | undefined;
  private _isDirty: boolean = false;

  constructor(
    scope: PropertyScope[] | undefined,
    private readonly _end: () => void,
    private readonly _rollback: () => void,
  ) {
    if (scope && scope.length > 0) {
      this._scope = new Map(scope.map(([obj, props]) => [obj, new Set(props)]));
    }
  }

  /** @internal */
  _onWrite(obj: TrackedObject, property: string): void {
    if (this._scope === undefined) return;
    const declaredProps = this._scope.get(obj);
    if (declaredProps === undefined || !declaredProps.has(property)) return;
    this._isDirty = true;
  }

  get isDirty(): boolean {
    if (this._scope === undefined) return false;
    return this._isDirty;
  }

  get isValid(): boolean {
    if (this._scope === undefined) return true;
    for (const [obj, props] of this._scope) {
      for (const prop of props) {
        if (obj.validationMessages.has(prop)) return false;
      }
    }
    return true;
  }

  get canCommit(): boolean {
    return this.isDirty && this.isValid;
  }

  get trackedObjects(): TrackedObject[] {
    if (this._scope === undefined) return [];
    return [...this._scope.keys()];
  }

  get deletedObjects(): TrackedObject[] {
    return this.trackedObjects.filter(obj => obj.state === State.Deleted);
  }

  end(): void {
    this._end();
  }

  rollback(): void {
    this._rollback();
  }
}
