#!/usr/bin/env node
// node src/cli.js run                 fetch every source, score, write data/report.html
// node src/cli.js rescore             score again without fetching (after changing config or matching)
// node src/cli.js mark <id> <status>  applied | skipped | shortlisted | new
// node src/cli.js top [n]             print the best n matches
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJobspy } from './sources/jobspy.js';
import { fetchAts } from './sources/ats.js';
import { loadResume } from './resume.js';
import { scoreJob } from './match.js';
import { writeReport } from './report.js';
import * as store from './store.js';
import { Run } from './status.js';

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const log = (...a) => console.log(...a);
const today = new Date().toISOString().slice(0, 10);

async function rescore(db, run) {
  run?.agent('matcher', 'running', `scoring ${Object.keys(db).length} jobs`);
  const resume = await loadResume(config.candidate.resumePdf);
  resume.name = config.candidate.name;
  const scored = [];
  const rejects = {};
  for (const j of Object.values(db)) {
    Object.assign(j, scoreJob(j, resume, config));
    if (j.rejected) {
      const k = j.rejected.split(':')[0].replace(/\d+/, 'N');
      rejects[k] = (rejects[k] || 0) + 1;
    } else if (j.score >= config.report.minScore) scored.push(j);
  }
  scored.sort((a, b) => b.score - a.score || (b.posted || '').localeCompare(a.posted || ''));
  store.save(db);
  log(`\nResume skills: ${resume.skills.join(', ')}`);
  log(`Rejected: ${Object.entries(rejects).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  log(`Matches at score >= ${config.report.minScore}: ${scored.length}`);
  log(`Report: ${path.resolve(writeReport(scored, resume))}`);
  run?.agent('matcher', 'done', `${scored.length} matches of ${Object.keys(db).length}`, scored.length);
  return { scored, rejects };
}

function printTop(list, n) {
  for (const j of list.slice(0, n)) {
    log(`${String(j.score).padStart(3)}  ${j.id}  ${j.title} | ${j.company} | ${j.location} | ${j.sources.join(',')}`);
  }
}

const [cmd = 'run', ...args] = process.argv.slice(2);
const db = store.load();

if (cmd === 'run') {
  const run = new Run(args[0] || 'manual');
  try {
    log('Fetching company job boards...');
    const ats = await fetchAts(config.ats, log, run);
    log('Fetching Indeed / LinkedIn...');
    const boards = await fetchJobspy(config.search, log, run);
    const before = new Set(Object.keys(db));
    const added = store.merge(db, [...ats, ...boards], today);
    log(`\n${ats.length + boards.length} postings fetched, ${added} new, ${Object.keys(db).length} in store`);
    const { scored, rejects } = await rescore(db, run);
    printTop(scored, 15);
    run.finish({
      fetched: ats.length + boards.length,
      added,
      total: Object.keys(db).length,
      matches: scored.length,
      newMatches: scored.filter((j) => !before.has(j.id)).length,
      rejects,
    });
  } catch (e) {
    run.record.errors.push(e.stack || String(e));
    run.finish({ failed: true });
    throw e;
  }
} else if (cmd === 'rescore') {
  printTop((await rescore(db)).scored, 15);
} else if (cmd === 'top') {
  printTop((await rescore(db)).scored, parseInt(args[0] || '25', 10));
} else if (cmd === 'mark') {
  const [id, status] = args;
  if (!db[id] || !['applied', 'skipped', 'shortlisted', 'new'].includes(status)) {
    log('usage: mark <id> <applied|skipped|shortlisted|new>');
    process.exit(1);
  }
  store.setStatus(db, id, status);
  store.save(db);
  log(`${db[id].title} @ ${db[id].company}: ${status}`);
} else {
  log('commands: run | rescore | top [n] | mark <id> <status>');
}
