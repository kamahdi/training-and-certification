// End-to-end journey 1 and 2 (qa/test-strategy.md › End-to-end journeys), in a real browser.
// Needs a running server with seeded staff: BASE_URL=http://localhost:3000 node e2e/journey.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

const brussels = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(d);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());
const inMinutes = (m) => brussels(new Date(Date.now() + m * 60000));

function check(cond, msg) {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}

const browser = await chromium.launch();
try {
  // 1. Reception imports the appointments file.
  const reception = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await reception.goto(`${BASE}/staff`);
  await reception.getByLabel('Email').fill('reception@demo.clinic');
  await reception.getByLabel('Password').fill('demo-password');
  await reception.getByRole('button', { name: 'Sign in' }).click();
  await reception.getByRole('heading', { name: "Today's appointments" }).waitFor();
  const csv = `patient name,phone number,professional,date,time\nSara Bauwens,0470 11 22 03,Dr. Peeters,${today},${inMinutes(20)}\nBen Kowalski,0470 11 22 02,Dr. Peeters,${today},${inMinutes(40)}\nBad Row,0470 11,Dr. Peeters,${today},${inMinutes(50)}\n`;
  writeFileSync(`${SHOTS}/appointments.csv`, csv);
  await reception.locator('input[type=file]').setInputFiles(`${SHOTS}/appointments.csv`);
  const result = reception.getByRole('status').filter({ hasText: 'File imported' });
  await result.waitFor();
  check(/2 appointments added, 1 row needs a look/.test(await result.innerText()), 'import result shows 2 added and 1 skipped row');
  check(/Row 4:/.test(await result.innerText()), 'the skipped row is listed with its number');
  await reception.screenshot({ path: `${SHOTS}/1-reception-import.png` });

  // 2. Sara checks in on her phone with a text code.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`${BASE}/c`);
  await phone.getByLabel('Phone number').fill('0470 11 22 03');
  await phone.getByRole('button', { name: 'Text me a code' }).click();
  await phone.getByText('Check-in · step 2 of 2').waitFor();
  const outbox = await (await reception.request.get(`${BASE}/api/dev/outbox`)).json(); // as reception: a container needs a sign-in
  const code = outbox.messages.reverse().find((m) => m.to === '+32470112203' && /code is/.test(m.body)).body.match(/(\d{4})/)[1];
  await phone.getByLabel('4-digit code').fill(code === '0000' ? '1111' : '0000');
  await phone.getByRole('button', { name: 'Check in' }).click();
  await phone.getByText(/That code is not right\. 2 tries left/).waitFor();
  check(true, 'a wrong code says how many tries are left');
  await phone.screenshot({ path: `${SHOTS}/2-phone-wrong-code.png` });
  await phone.getByLabel('4-digit code').fill(code);
  await phone.getByRole('button', { name: 'Check in' }).click();
  await phone.waitForURL(/\/v\//);
  await phone.getByText('Please stay in the waiting room').waitFor();
  check(/Checked in at/.test(await phone.innerText('main')), 'the visit page shows the check-in');
  await phone.screenshot({ path: `${SHOTS}/3-phone-visit-waiting.png` });

  // 3. Dr. Peeters calls the next patient; Sara's page changes live.
  const doctor = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await doctor.goto(`${BASE}/staff`);
  await doctor.getByLabel('Email').fill('peeters@demo.clinic');
  await doctor.getByLabel('Password').fill('demo-password');
  await doctor.getByRole('button', { name: 'Sign in' }).click();
  const nextBtn = doctor.getByRole('button', { name: 'Next patient: call Sara Bauwens' });
  await nextBtn.waitFor();
  await doctor.getByText('Live', { exact: true }).waitFor();
  await nextBtn.click();
  await doctor.getByText(/You called Sara Bauwens at/).waitFor();
  check(await doctor.getByRole('button', { name: /Undo · \d+ s/ }).isVisible(), 'the calling banner offers an undo countdown');
  await doctor.screenshot({ path: `${SHOTS}/4-doctor-calling.png` });

  await phone.getByRole('heading', { name: /You're being called, Sara/ }).waitFor({ timeout: 5000 });
  check(/Room 3/.test(await phone.innerText('main')), "Sara's page shows the room without a reload");
  await phone.screenshot({ path: `${SHOTS}/5-phone-called.png` });

  // 4. Reception sees Sara as called.
  await reception.reload();
  await reception.getByText('Called · room 3').waitFor();
  check(true, 'reception sees the call');
  console.log('\njourney passed');
} finally {
  await browser.close();
}
