#!/usr/bin/env node
// node src/apply.js <job id>           open the job's form in Chrome, fill it, wait for YOU to press Submit
// node src/apply.js --test <url>...    fill real forms with a fake profile, headless, screenshot, never submit
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import * as store from './store.js';
import { fillForm, showBanner, snapshotScript, reportChanges, formUrl } from './apply/fill.js';
import { loadBank, learn, keyOf, NEVER } from './apply/answers.js';
import { setApplier } from './status.js';

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
// Your details live outside git: copy profile.example.json to data/profile.json.
config.profile = JSON.parse(fs.readFileSync(config.applier.profile, 'utf8'));
const PROFILE_DIR = 'data/browser-profile';
const LOG = 'data/applications.json';
const WAIT_MINUTES = Number(process.env.JA_WAIT_MINUTES || 45);
const HEADLESS = process.env.JA_HEADLESS === '1';

// Job boards' own forms are never filled: your account there is yours to use.
const NO_FILL = /(^|\.)(linkedin\.com|indeed\.com|naukri\.com|glassdoor\.(com|co\.in))$/i;
const CONFIRM_TEXT = /thank you for (applying|your application)|application (has been |was )?(submitted|received)|we('ve| have) received your application|successfully (submitted|applied)/i;
const CONFIRM_URL = /\/(thanks|confirmation|submitted|success)\b/i;

const TEST_PROFILE = {
  firstName: 'Test', lastName: 'Candidate', email: 'test.candidate@example.com', phone: '9000000000', phoneCountryCode: '+91',
  city: 'Kolkata', state: 'West Bengal', country: 'India', currentCompany: 'Example Co', currentTitle: 'Developer',
  linkedin: 'https://www.linkedin.com/in/example', github: 'https://github.com/example', portfolio: 'https://example.com',
  yearsExperience: '0', degree: "Bachelor's Degree", degreeName: 'B.Tech', college: 'Example College', graduationYear: '2025', cgpa: '7.5',
  workAuthorizedIndia: 'Yes', needsSponsorship: 'No', willingToRelocate: 'Yes', willingToWorkFromOffice: 'Yes', howDidYouHear: 'LinkedIn',
  noticePeriod: '', currentCtc: '', expectedCtc: '',
};

function testResume() {
  const p = 'data/test-resume.pdf';
  if (!fs.existsSync(p)) {
    // Smallest valid one-page PDF.
    const body = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
    fs.writeFileSync(p, body);
  }
  return path.resolve(p);
}

async function waitForForm(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('input[type="email"], input[name*="email" i], input[id*="email" i]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function runTest(urls) {
  const browser = await chromium.launch({ channel: config.applier.browser, headless: true });
  for (const [i, url] of urls.entries()) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForForm(page);
    const r = await fillForm(page, { profile: TEST_PROFILE, bank: {}, resumePath: testResume() });
    await showBanner(page, r, 'test');
    const shot = `data/test-fill-${i + 1}.png`;
    await page.screenshot({ path: shot, fullPage: true });
    console.log(`\n== ${url}\nresume attached: ${r.resumeDone}\nfilled ${r.filled.length}:`);
    for (const f of r.filled) console.log(`  + ${f.label.slice(0, 70)} = ${String(f.value).slice(0, 50)} (${f.from})`);
    console.log(`left for the person ${r.needs.length}:`);
    for (const n of r.needs) console.log(`  ? ${n.label.slice(0, 90)}${n.required ? ' [required]' : ''}${n.consent ? ' [consent]' : ''}`);
    console.log(`screenshot: ${shot}`);
    await page.close();
  }
  await browser.close();
}

function logApplication(entry) {
  let all = [];
  try { all = JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch {}
  all.push(entry);
  fs.writeFileSync(LOG, JSON.stringify(all, null, 1));
}

async function runJob(id) {
  const db = store.load();
  const job = db[id];
  if (!job) throw new Error(`no job ${id}`);
  const url = formUrl(job) || job.applyUrl;
  const label = `${job.title} @ ${job.company || 'company'}`;
  const update = (state, detail) => setApplier({ state, detail, jobId: id, pid: process.pid });
  const fillArgs = () => ({ profile: config.profile, bank: loadBank(), resumePath: path.resolve(config.candidate.resumePdf) });

  update('running', `opening ${label}`);
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { channel: config.applier.browser, headless: HEADLESS, viewport: null, args: ['--start-maximized'] });
  const filledAt = new Map(); // url -> { page, result, snap }
  await ctx.exposeBinding('jaSnap', ({ page }, snap) => {
    for (const e of filledAt.values()) if (e.page === page && snap && Object.keys(snap).length) e.snap = snap;
  });
  const first = ctx.pages()[0] || (await ctx.newPage());
  await first.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Every tab is watched: "Apply on company site" usually opens a new one.
  // A form is filled once per address, the first time it appears, and never on a job board's own pages.
  const firstUrlText = new Map(); // page -> whether its first address already read like a thank-you page
  let outcome = 'timeout';
  let confirmedPage = null;
  const deadline = Date.now() + WAIT_MINUTES * 60000;
  let lastNote = '';
  while (Date.now() < deadline) {
    const pages = ctx.pages().filter((p) => !p.isClosed());
    if (!pages.length) { outcome = 'closed'; break; }
    for (const page of pages) {
      try {
        const here = page.url().split('#')[0];
        const text = await page.evaluate(() => document.body?.innerText?.slice(0, 6000) || '');
        if (!firstUrlText.has(page)) firstUrlText.set(page, { url: here, thanks: CONFIRM_TEXT.test(text) });
        const base = firstUrlText.get(page);
        const thanks = CONFIRM_URL.test(here) || (CONFIRM_TEXT.test(text) && !(base.url === here && base.thanks));
        if (thanks && (filledAt.size || here !== url)) { outcome = 'submitted'; confirmedPage = page; break; }

        if (filledAt.has(here)) continue;
        if (NO_FILL.test(new URL(here).host)) continue;
        const hasForm = await page.evaluate(() => !!document.querySelector('input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete="email"]'));
        if (!hasForm) continue;
        await page.waitForTimeout(1500);
        update('running', `filling ${label}`);
        const result = await fillForm(page, fillArgs());
        await showBanner(page, result, label);
        filledAt.set(here, { page, result, snap: await page.evaluate(`(${snapshotScript})()`) });
        await reportChanges(page);
        lastNote = `filled ${result.filled.length}, ${result.needs.length} for you`;
      } catch {
        // Mid-navigation; look again.
      }
    }
    if (outcome === 'submitted') break;
    update('waiting', filledAt.size
      ? `${label}: ${lastNote}. Waiting for you to press Submit`
      : `${label}: opened. Press the site's Apply button; a company form gets filled when it appears`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  const results = [...filledAt.values()];
  let learned = 0;
  if (outcome === 'submitted') {
    const fresh = store.load();
    store.setStatus(fresh, id, 'applied');
    store.save(fresh);
    // Remember what you typed into questions the profile did not answer.
    const pairs = [];
    for (const { result, snap } of results) {
      const auto = new Map(result.filled.map((f) => [keyOf(f.label), String(f.value)]));
      for (const [ja, value] of Object.entries(snap || {})) {
        const f = result.fieldsByJa[ja];
        if (!f || !value || f.kind === 'textarea' || NEVER.test(f.label)) continue;
        if (auto.get(keyOf(f.label)) === value) continue;
        pairs.push([f.label, value]);
      }
    }
    learned = learn(pairs);
  }
  logApplication({
    id, title: job.title, company: job.company, url, at: new Date().toISOString(), outcome,
    forms: [...filledAt.keys()],
    filled: results.flatMap((r) => r.result.filled),
    left: results.flatMap((r) => r.result.needs.map((n) => n.label)),
    learned,
  });
  update(outcome === 'submitted' ? 'done' : 'idle',
    outcome === 'submitted' ? `applied: ${label}${learned ? `, learned ${learned} answers` : ''}` : `${label}: ${outcome === 'closed' ? 'window closed without submitting' : 'gave up waiting'}`);
  if (confirmedPage && !confirmedPage.isClosed()) await confirmedPage.waitForTimeout(4000);
  await ctx.close().catch(() => {});
}

const args = process.argv.slice(2);
try {
  if (args[0] === '--test') await runTest(args.slice(1));
  else if (args[0]) await runJob(args[0]);
  else console.log('usage: node src/apply.js <job id> | --test <url>...');
} catch (e) {
  if (args[0] && args[0] !== '--test') setApplier({ state: 'error', detail: e.message.split('\n')[0], jobId: args[0] });
  console.error(e);
  process.exit(1);
}
