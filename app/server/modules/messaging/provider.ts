/**
 * Text-message provider adapter. The real provider is not chosen yet (architecture.md › Open decisions),
 * so the default is a fake that records messages and reports delivery at once.
 */
export interface SendResult {
  providerId: string;
  delivered: boolean;
}
export interface SmsProvider {
  send(to: string, body: string): Promise<SendResult>;
}

let failWhen: ((to: string) => string | null) | null = null;
let counter = 0;
export const sentByFake: { to: string; body: string }[] = [];

export const fakeProvider: SmsProvider = {
  async send(to, body) {
    const reason = failWhen?.(to) ?? null;
    if (reason) throw new ProviderError(reason);
    sentByFake.push({ to, body });
    counter++;
    return { providerId: `fake-${counter}`, delivered: true };
  },
};

export class ProviderError extends Error {}

/** Tests: make the fake fail for some numbers, e.g. to simulate an invalid number. */
export function setFakeFailure(fn: ((to: string) => string | null) | null) {
  failWhen = fn;
}

let current: SmsProvider = fakeProvider;
export function getProvider(): SmsProvider {
  return current;
}
export function setProvider(p: SmsProvider) {
  current = p;
}
