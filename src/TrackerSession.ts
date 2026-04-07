export interface ScopeTarget {
  validationMessages: Map<string, string | undefined>;
}

export type PropertyScope = [ScopeTarget, string[]];

export class TrackerSession {
  private readonly _scope: Map<ScopeTarget, Set<string>> | undefined;
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
  _onWrite(obj: ScopeTarget, property: string): void {
    if (this._scope === undefined) return;
    const declaredProps = this._scope.get(obj);
    if (declaredProps === undefined || !declaredProps.has(property)) return;
    this._isDirty = true;
  }

  get isDirty(): boolean | undefined {
    if (this._scope === undefined) return undefined;
    return this._isDirty;
  }

  get isValid(): boolean | undefined {
    if (this._scope === undefined) return undefined;
    for (const [obj, props] of this._scope) {
      for (const prop of props) {
        if (obj.validationMessages.has(prop)) return false;
      }
    }
    return true;
  }

  end(): void {
    this._end();
  }

  rollback(): void {
    this._rollback();
  }
}
