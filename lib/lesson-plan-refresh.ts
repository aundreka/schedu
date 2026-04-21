type LessonPlanRefreshListener = (version: number) => void;

let refreshVersion = 0;
const listeners = new Set<LessonPlanRefreshListener>();

export function emitLessonPlanRefresh() {
  refreshVersion += 1;
  listeners.forEach((listener) => listener(refreshVersion));
}

export function getLessonPlanRefreshVersion() {
  return refreshVersion;
}

export function subscribeToLessonPlanRefresh(listener: LessonPlanRefreshListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
