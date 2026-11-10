/**
 * Text-message templates. Rule: no health data in any text (definition of done).
 * Only clinic name, professional, date, time, codes and links are allowed as variables.
 * English now; French and Dutch arrive with story 8.4 (P1).
 */
export type TemplateName =
  | 'confirmation'
  | 'confirmation_same_day'
  | 'reminder'
  | 'reminder_form_done'
  | 'delay'
  | 'walk_in'
  | 'checkin_code'
  | 'export_code';

export const ALLOWED_VARS = ['clinic', 'professional', 'date', 'time', 'visitUrl', 'formUrl', 'lateness', 'suggested', 'code'] as const;
export type TemplateVars = Partial<Record<(typeof ALLOWED_VARS)[number], string>>;

const en: Record<TemplateName, string> = {
  confirmation: '{clinic}: your appointment with {professional} is on {date} at {time}. On the day, follow your wait here: {visitUrl}',
  confirmation_same_day:
    '{clinic}: your appointment with {professional} is today at {time}. Please fill in this short form before you come: {formUrl} Follow your wait here: {visitUrl}',
  reminder: '{clinic}: reminder, your appointment with {professional} is tomorrow at {time}. Please fill in this short form before you come: {formUrl}',
  reminder_form_done: '{clinic}: reminder, your appointment with {professional} is tomorrow at {time}. Thank you for filling in the form.',
  delay: '{clinic}: {professional} is running about {lateness} min late. Please come at {suggested} instead of {time}. Follow your wait here: {visitUrl}',
  walk_in: '{clinic}: you are checked in to see {professional}. Follow your wait here: {visitUrl}',
  checkin_code: '{clinic}: your check-in code is {code}. It works for 10 minutes.',
  export_code: '{clinic}: your code to receive a copy of your data is {code}. It works for 10 minutes.',
};

export const templates: Record<string, Record<TemplateName, string>> = { en };

export function render(name: TemplateName, vars: TemplateVars, language = 'en'): string {
  const t = (templates[language] ?? en)[name];
  return t.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (!(ALLOWED_VARS as readonly string[]).includes(k)) throw new Error(`Variable ${k} is not allowed in texts`);
    const v = vars[k as keyof TemplateVars];
    if (v === undefined) throw new Error(`Missing variable ${k} for template ${name}`);
    return v;
  });
}
