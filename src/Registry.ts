import { ITracked as ITrackedItem } from "./ITracked";
import { DependencyTracker } from "./DependencyTracker";

type ValidatorMap = Map<string, (model: any) => string | undefined>;
const VALIDATORS = Symbol("validators");

export function registerPropertyValidator(
  proto: object,
  property: string,
  validator: (model: any) => string | undefined,
): void {
  if (!(VALIDATORS in proto)) {
    Object.defineProperty(proto, VALIDATORS, {
      value: new Map<string, (model: any) => string | undefined>(),
      configurable: true,
    });
  }
  const map = (proto as any)[VALIDATORS] as ValidatorMap;
  if (!map.has(property)) {
    map.set(property, validator);
  }
}

export function validate(tracked: ITrackedItem): void {
  const proto = Object.getPrototypeOf(tracked);
  if (!(VALIDATORS in proto)) return;
  const validators = (proto as any)[VALIDATORS] as ValidatorMap;
  const messages = new Map<string, string>();
  validators.forEach((validatorFn, property) => {
    const deps = DependencyTracker.collect(() => {
      const error = validatorFn(tracked);
      if (error !== undefined) messages.set(property, error);
    });
    DependencyTracker.updateDeps(tracked, property, deps);
  });
  tracked._applyValidation(messages);
}

export function validateSingleProperty(
  tracked: ITrackedItem,
  property: string,
): string | undefined {
  const proto = Object.getPrototypeOf(tracked);
  if (!(VALIDATORS in proto)) return undefined;
  const validators = (proto as any)[VALIDATORS] as ValidatorMap;
  const validatorFn = validators.get(property);
  if (!validatorFn) return undefined;
  let error: string | undefined;
  const deps = DependencyTracker.collect(() => {
    error = validatorFn(tracked);
  });
  DependencyTracker.updateDeps(tracked, property, deps);
  return error;
}
