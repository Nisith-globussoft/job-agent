// data/jobs.json: every job ever seen, keyed by a stable id, with its status.
// Status: new -> shortlisted / skipped -> applied. A re-scrape never resets a status.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { norm } from './text.js';

const FILE = 'data/jobs.json';

export const jobKey = (j) =>
  crypto.createHash('sha1').update(`${norm(j.company)}|${norm(j.title)}|${norm(j.location).split(' ')[0] || ''}`).digest('hex').slice(0, 12);

export function load() {
  return fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
}

export function save(db) {
  // A status set from the dashboard while a run held its own copy wins over that copy.
  for (const [id, disk] of Object.entries(load())) {
    const mine = db[id];
    if (mine && (disk.history?.length || 0) > (mine.history?.length || 0)) {
      Object.assign(mine, { status: disk.status, appliedOn: disk.appliedOn, history: disk.history });
    }
  }
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 1));
  fs.renameSync(FILE + '.tmp', FILE);
}

export const STATUSES = ['new', 'shortlisted', 'applied', 'skipped'];

export function setStatus(db, id, status) {
  const j = db[id];
  const at = new Date().toISOString();
  j.status = status;
  if (status === 'applied') j.appliedOn = at.slice(0, 10);
  (j.history ||= []).push({ status, at });
}

export function merge(db, jobs, today) {
  let added = 0;
  for (const j of jobs) {
    const id = jobKey(j);
    const old = db[id];
    if (!old) added++;
    // Keep the longer description when the same posting arrives from two sources.
    const keep = old && (old.description || '').length > (j.description || '').length ? old : j;
    db[id] = {
      ...keep,
      id,
      sources: [...new Set([...(old?.sources || []), j.source])],
      firstSeen: old?.firstSeen || today,
      lastSeen: today,
      status: old?.status || 'new',
    };
  }
  return added;
}
