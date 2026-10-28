#!/usr/bin/env node
// Local dashboard: node src/server.js, then open http://localhost:4317
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import { readStatus, readRuns } from './status.js';
import { formUrl } from './apply/fill.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);
const PORT = Number(process.env.PORT || 4317);
const LOG = 'data/last-run.log';
const config = () => JSON.parse(fs.readFileSync('config.json', 'utf8'));

function state() {
  const db = store.load();
  const all = Object.values(db);
  const minScore = config().report.minScore;
  const isMatch = (j) => !j.rejected && j.score >= minScore;
  const today = new Date().toISOString().slice(0, 10);

  const bySource = {};
  for (const j of all) {
    for (const s of j.sources || []) {
      const b = (bySource[s] ||= { collected: 0, matches: 0 });
      b.collected++;
      if (isMatch(j)) b.matches++;
    }
  }
  const byStatus = Object.fromEntries(store.STATUSES.map((s) => [s, 0]));
  const rejected = {};
  for (const j of all) {
    if (isMatch(j) || j.status !== 'new') byStatus[j.status]++;
    if (j.rejected) {
      const k = j.rejected.split(':')[0].replace(/\d+/, 'N');
      rejected[k] = (rejected[k] || 0) + 1;
    }
  }
  const appliedByDay = {};
  for (let d = 13; d >= 0; d--) appliedByDay[new Date(Date.now() - d * 864e5).toISOString().slice(0, 10)] = 0;
  for (const j of all) if (j.appliedOn && j.appliedOn in appliedByDay) appliedByDay[j.appliedOn]++;

  const jobs = all
    .filter((j) => isMatch(j) || j.status !== 'new')
    .sort((a, b) => b.score - a.score)
    .map((j) => ({
      id: j.id, title: j.title, company: j.company, location: j.location, sources: j.sources,
      posted: j.posted, firstSeen: j.firstSeen, url: j.url, applyUrl: j.applyUrl, score: j.score,
      reasons: j.reasons, matched: j.matched, missing: j.missing, status: j.status, appliedOn: j.appliedOn,
      fillable: !!formUrl(j) || !/(linkedin|indeed|naukri|glassdoor)\./i.test(j.applyUrl || ''),
    }));

  return {
    status: readStatus(),
    runs: readRuns().slice(-30).reverse(),
    stats: {
      collected: all.length,
      matches: all.filter(isMatch).length,
      newToday: all.filter((j) => isMatch(j) && j.firstSeen === today).length,
      minScore, bySource, byStatus, rejected, appliedByDay,
    },
    jobs,
  };
}

function startApply(id) {
  const ap = readStatus().agents.applier;
  if (ap.state === 'running' || ap.state === 'waiting') return 'The applier is busy with another job: submit or close that window first.';
  const out = fs.openSync('data/last-apply.log', 'w');
  spawn(process.execPath, ['src/apply.js', id], { cwd: ROOT, stdio: ['ignore', out, out], detached: true }).unref();
  return null;
}

function startRun() {
  if (readStatus().running) return false;
  const out = fs.openSync(LOG, 'w');
  const child = spawn(process.execPath, ['src/cli.js', 'run', 'dashboard'], { cwd: ROOT, stdio: ['ignore', out, out], detached: true });
  child.unref();
  return true;
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

const readBody = (req) => new Promise((ok, bad) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 1e5) req.destroy(); });
  req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } });
});

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, fs.readFileSync('src/dashboard.html'), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, state());
    if (req.method === 'GET' && url.pathname === '/api/log') {
      return send(res, 200, fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').slice(-200).join('\n') : '', 'text/plain; charset=utf-8');
    }
    if (req.method === 'POST') {
      // Only this page sends the header; another site would need a CORS preflight this server never grants.
      if (req.headers['x-job-agent'] !== '1') return send(res, 403, { error: 'forbidden' });
      if (url.pathname === '/api/run') return startRun() ? send(res, 202, { started: true }) : send(res, 409, { error: 'a run is already going' });
      const a = url.pathname.match(/^\/api\/apply\/([0-9a-f]{12})$/);
      if (a) {
        if (!store.load()[a[1]]) return send(res, 404, { error: 'no such job' });
        const busy = startApply(a[1]);
        return busy ? send(res, 409, { error: busy }) : send(res, 202, { started: true });
      }
      const m = url.pathname.match(/^\/api\/jobs\/([0-9a-f]{12})$/);
      if (m) {
        const { status } = await readBody(req);
        const db = store.load();
        if (!db[m[1]] || !store.STATUSES.includes(status)) return send(res, 400, { error: 'bad job or status' });
        store.setStatus(db, m[1], status);
        store.save(db);
        return send(res, 200, { ok: true });
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Dashboard: http://localhost:${PORT}`));
