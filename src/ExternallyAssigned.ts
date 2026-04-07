export interface IdAssignment {
  trackingId: number;
  value: number;
}

const AUTO_ID = Symbol("autoId");

export function AutoId<This extends object, Value>(
  _target: undefined,
  context: ClassFieldDecoratorContext<This, Value>,
): void {
  context.addInitializer(function (this: This) {
    Object.defineProperty(Object.getPrototypeOf(this), AUTO_ID, {
      value: String(context.name),
      configurable: true,
    });
  });
}

export function getAutoIdProperty(
  proto: object,
): string | undefined {
  return AUTO_ID in proto
    ? ((proto as any)[AUTO_ID] as string)
    : undefined;
}
