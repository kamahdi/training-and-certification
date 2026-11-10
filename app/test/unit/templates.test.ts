import { ALLOWED_VARS, render, templates } from '../../server/modules/messaging/templates.js';

const vars = { clinic: 'C', professional: 'Dr. P', date: 'Thursday 12 November', time: '10:15', visitUrl: 'U', formUrl: 'F', lateness: '20', suggested: '10:35', code: '1234' };

describe('text templates', () => {
  it('WR-03: every template renders with only clinic, professional, time, links and codes', () => {
    for (const [lang, set] of Object.entries(templates)) {
      for (const name of Object.keys(set)) {
        const used = [...set[name as keyof typeof set].matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        expect(used.every((u) => (ALLOWED_VARS as readonly string[]).includes(u)), `${lang}/${name}`).toBe(true);
        expect(render(name as any, vars, lang)).not.toMatch(/\{/);
      }
    }
  });

  it('WR-05: answers are never included in a text message: unknown variables are refused', () => {
    expect(() => render('confirmation', { ...vars, reason: 'chest pain' } as any)).not.toThrow();
    const t = templates.en.confirmation;
    expect(t).not.toMatch(/reason|medication|fund|member/i);
    expect(() => {
      (templates.en as any).bad = 'Your reason: {reason}';
      render('bad' as any, { ...vars, reason: 'x' } as any);
    }).toThrow(/not allowed/);
    delete (templates.en as any).bad;
  });
});
