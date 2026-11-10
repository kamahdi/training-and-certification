import axe from 'axe-core';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';

/** Mock fetch with a list of [method path-prefix, response] pairs, checked in order. */
export function mockApi(routes: Array<[string, (body: any) => { status?: number; json: any }]>) {
  const calls: { method: string; url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const hit = routes.find(([k]) => {
      const [m, p] = k.split(' ');
      return m === method && url.startsWith(p);
    });
    if (!hit) throw new Error(`unmocked ${method} ${url}`);
    const r = hit[1](body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as any;
  return calls;
}

export function renderAt(path: string, routePath: string, el: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={el} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** axe-core on the rendered DOM; colour contrast is checked in the browser, not jsdom. */
export async function axeViolations(container: HTMLElement) {
  const r = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
