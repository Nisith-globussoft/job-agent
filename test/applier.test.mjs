// End-to-end check of the applier against a local fixture form: fills, leaves consent alone,
// notices the submit, marks the job applied and learns the answer the "person" typed.
// node test/applier.test.mjs   (do not run while a scrape is saving data/jobs.json)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);
const store = await import('../src/store.js');
const ID = 'f1f1f1f1f1f1';
const files = ['data/answers.json', 'data/applications.json', 'data/applier.json'];
const saved = Object.fromEntries(files.map((f) => [f, fs.existsSync(f) ? fs.readFileSync(f) : null]));

let seen = null;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/seen') {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { seen = JSON.parse(b); res.end('ok'); });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(fs.readFileSync('test/fixture-form.html'));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/form?autosubmit=8`;

const db = store.load();
db[ID] = { id: ID, title: 'Backend Developer (fixture)', company: 'Fixture Co', location: 'Remote', sources: ['test'], url, applyUrl: url, status: 'new', score: 99 };
store.save(db);

try {
  // Async, so this process's fixture server keeps answering while the applier runs.
  const r = await new Promise((ok) => {
    const p = spawn(process.execPath, ['src/apply.js', ID], { env: { ...process.env, JA_HEADLESS: '1', JA_WAIT_MINUTES: '1' } });
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (out += c));
    p.on('close', (status) => ok({ status, out }));
  });
  if (r.status !== 0) console.error(r.out);
  assert.equal(r.status, 0, 'applier exited cleanly');

  const cfg = JSON.parse(fs.readFileSync('data/profile.json', 'utf8'));
  assert.ok(seen, 'the fixture reported what the agent filled');
  assert.equal(seen.fn, cfg.firstName, 'first name filled');
  assert.equal(seen.em, cfg.email, 'email filled');
  assert.equal(seen.co, 'India', 'country picked');
  assert.equal(seen.auth, 'yes', 'work authorization answered');
  assert.equal(seen.cv, 1, 'resume attached');
  assert.equal(seen.consentByAgent, false, 'consent box left for the person');
  assert.equal(seen.np, '', 'unknown question left empty');

  assert.equal(store.load()[ID].status, 'applied', 'job marked applied');
  const log = JSON.parse(fs.readFileSync('data/applications.json', 'utf8')).at(-1);
  assert.equal(log.outcome, 'submitted');
  assert.ok(log.left.some((l) => /privacy/i.test(l)), 'consent listed as left for the person');
  const bank = JSON.parse(fs.readFileSync('data/answers.json', 'utf8'));
  assert.equal(bank['notice period in days'], '15', 'answer typed by the person was learned');
  assert.ok(!Object.keys(bank).some((k) => /privacy|agree/.test(k)), 'consent never learned');
  console.log('PASS: applier fills, leaves consent, detects submit, marks applied, learns answers');
} finally {
  server.close();
  const after = store.load();
  delete after[ID];
  store.save(after);
  for (const [f, buf] of Object.entries(saved)) buf === null ? fs.rmSync(f, { force: true }) : fs.writeFileSync(f, buf);
}
