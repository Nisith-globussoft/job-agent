# job-agent

Collects backend / full-stack / MERN jobs from many sources, scores each one against your
resume, and writes a ranked page with an Apply link for each match.

## Run

```bash
npm install
node src/cli.js run          # fetch everything, score it, write data/report.html
node src/cli.js top 30       # best 30 in the terminal
node src/cli.js mark <id> applied     # or skipped / shortlisted
node src/cli.js rescore      # after editing config.json, without fetching again
```

Open `data/report.html` in a browser.

## Dashboard

```bash
npm start                    # http://localhost:4317
```

Shows each agent live (running / waiting / done / error / planned) with its count, the totals
(collected, matches, new today, shortlisted, applied), collected vs matched per source, why jobs
were dropped, applications per day, every run, and the job list with Apply / Applied / Shortlist /
Skip. "Run now" starts a run in the background and the page follows it. It listens on
127.0.0.1 only.

## Applier

Press **Auto-fill** (or **Open + fill**) on a job in the dashboard, or run
`node src/apply.js <job id>`. Chrome opens with its own profile (`data/browser-profile`, not your
everyday Chrome) and:

- fills name, email, phone, location, links, education, work authorization, country, resume upload
  and the common questions from `data/profile.json` (outside git; start from `profile.example.json`);
- picks "decline" on equal-opportunity questions when the form offers it;
- outlines in yellow whatever it left for you, and never ticks a consent / "I agree" box;
- watches every tab, so a company form reached through "Apply on company site" gets filled when it
  appears; LinkedIn, Indeed, Naukri and Glassdoor's own forms are never filled;
- **never presses Submit.** When the thank-you page shows, the job is marked applied, and what you
  typed into questions it could not answer is saved in `data/answers.json` for the next form.

Every attempt is logged in `data/applications.json`. Fill `noticePeriod`, `currentCtc` and
`expectedCtc` in `data/profile.json` to stop being asked for them.

```bash
node src/apply.js --test <form url>...   # fill real forms with a fake profile, headless, screenshots, no submit
npm test                                 # end-to-end check against a local fixture form
```

## Sources

| Source | How | Notes |
|---|---|---|
| Greenhouse, Lever, Ashby | the companies' own public job-board APIs | best quality; list in `config.json` -> `ats` |
| Indeed India | `ts-jobspy` | no login |
| LinkedIn | `ts-jobspy`, guest job listings | no login, your account is never used |
| Naukri | `ts-jobspy` | currently blocked (HTTP 406) |

## Matching

A job is dropped when it is outside India / India-open remote, is not a developer role, is a
different specialisation (data, mobile, DevOps, QA, frontend-only...), has a senior title, or
asks for more than `maxYearsRequired` years. The rest get 0-100:

- role fit (MERN > full-stack > backend > general SWE): up to 30
- seniority fit (fresher / 0-1 yrs best): up to 20
- share of the JD's skills that are on your resume, plus Node/Express/React/MongoDB: up to 45
- remote or near Kolkata: up to 5

Every score lists its reasons, and the skills you have (green) and lack (red).

## Files

- `config.json` -- search terms, locations, company boards, years, minimum score
- `data/resume.pdf` -- the resume the skills are read from
- `data/jobs.json` -- every job seen, with its status (a re-run never resets a status)
- `data/report.html` -- the ranked page
