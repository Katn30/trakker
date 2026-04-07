import { TrackedObject } from "./TrackedObject";

export interface ITrackerContext {
  isDirty: boolean;
  isValid: boolean;
  canCommit: boolean;
  trackedObjects: TrackedObject[];
  deletedObjects: TrackedObject[];
}
