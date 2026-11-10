/**
 * The only place that reads the time (docs/architecture/coding-standards.md › One clock).
 * Tests replace it with setClock().
 */
export interface Clock {
  now(): Date;
}

// eslint-disable-next-line no-restricted-syntax -- the one allowed use
const systemClock: Clock = { now: () => new Date() };
let current: Clock = systemClock;

export const clock = {
  now: () => current.now(),
};

export function setClock(c: Clock | null) {
  current = c ?? systemClock;
}

/** A clock fixed at an instant that tests can move forward. */
export function fixedClock(start: Date | string) {
  let t = typeof start === 'string' ? Date.parse(start) : start.getTime();
  return {
    now: () => new Date(t),
    set: (d: Date | string) => {
      t = typeof d === 'string' ? Date.parse(d) : d.getTime();
    },
    advance: (minutes: number) => {
      t += minutes * 60_000;
    },
  };
}
