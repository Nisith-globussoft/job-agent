// data/status.json: what each agent is doing right now, read by the dashboard.
// data/runs.json: one record per finished run (newest last).
import fs from 'node:fs';

const STATUS = 'data/status.json';
const RUNS = 'data/runs.json';

export const AGENTS = {
  ats: { name: 'Company boards', what: 'Greenhouse, Lever, Ashby' },
  indeed: { name: 'Indeed', what: 'Indeed India, no login' },
  linkedin: { name: 'LinkedIn jobs', what: 'Guest listings, no login' },
  naukri: { name: 'Naukri', what: 'Blocked by Naukri (HTTP 406)', planned: true },
  matcher: { name: 'Matcher', what: 'Scores jobs against your resume' },
  applier: { name: 'Applier', what: 'Fills forms, you press submit', planned: true },
  referrals: { name: 'Referral mailer', what: 'Drafts referral emails for approval', planned: true },
};

const writeJson = (file, data) => {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 1));
  fs.renameSync(file + '.tmp', file);
};
const readJson = (file, dflt) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dflt; }
};

export function readStatus() {
  const s = readJson(STATUS, { running: false, agents: {} });
  // A run whose process died is not running.
  if (s.running && s.pid) {
    try { process.kill(s.pid, 0); } catch { s.running = false; s.stale = true; }
  }
  for (const [id, a] of Object.entries(AGENTS)) {
    s.agents[id] = { ...a, state: a.planned ? 'planned' : 'idle', ...s.agents[id] };
  }
  return s;
}

export const readRuns = () => readJson(RUNS, []);

export class Run {
  constructor(trigger) {
    this.record = { id: new Date().toISOString(), trigger, startedAt: new Date().toISOString(), sources: {}, errors: [] };
    this.status = { running: true, pid: process.pid, runId: this.record.id, startedAt: this.record.startedAt, agents: {} };
    for (const id of Object.keys(AGENTS)) {
      this.status.agents[id] = { state: AGENTS[id].planned ? 'planned' : 'waiting', count: 0, detail: '' };
    }
    this.flush();
  }

  agent(id, state, detail = '', count) {
    const a = this.status.agents[id];
    a.state = state;
    a.detail = detail;
    if (count !== undefined) a.count = count;
    a.updatedAt = new Date().toISOString();
    if (state === 'error') this.record.errors.push(`${AGENTS[id].name}: ${detail}`);
    this.flush();
  }

  add(id, n) {
    this.status.agents[id].count += n;
    this.record.sources[id] = (this.record.sources[id] || 0) + n;
    this.flush();
  }

  flush() { writeJson(STATUS, this.status); }

  finish(summary) {
    Object.assign(this.record, summary, { finishedAt: new Date().toISOString() });
    const runs = readRuns();
    runs.push(this.record);
    writeJson(RUNS, runs.slice(-200));
    this.status.running = false;
    this.status.finishedAt = this.record.finishedAt;
    for (const a of Object.values(this.status.agents)) if (a.state === 'running' || a.state === 'waiting') a.state = 'done';
    this.flush();
  }
}
