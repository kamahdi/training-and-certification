import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Normalise to E.164 (Belgium as default country). Returns null when not a valid number. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const p = parsePhoneNumberFromString(String(input).trim(), 'BE');
  if (!p || !p.isValid()) return null;
  return p.number; // E.164, e.g. +32470123456
}

/** "+32 470 12 34 56" for screens. */
export function displayPhone(e164: string): string {
  const p = parsePhoneNumberFromString(e164);
  return p ? p.formatInternational() : e164;
}

/** "+32 470 •• •• 56" for screens that must not show the whole number. */
export function maskPhone(e164: string): string {
  const shown = displayPhone(e164);
  const digits = shown.split('');
  let seen = 0;
  const totalDigits = shown.replace(/\D/g, '').length;
  return digits
    .map((ch) => {
      if (!/\d/.test(ch)) return ch;
      seen++;
      return seen <= 5 || seen > totalDigits - 2 ? ch : '•';
    })
    .join('');
}
