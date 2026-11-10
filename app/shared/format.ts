/** "Thursday 12 November" in the clinic's zone. */
export function formatDay(d: Date, tz: string, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}
