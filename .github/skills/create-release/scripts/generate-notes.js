#!/usr/bin/env node
// generate-notes.js — produce a categorized release-notes skeleton for a tag range.
//
// Dependency-free: requires `git`; uses `gh` only when --enrich-prs is passed.
// Writes the notes skeleton to stdout and a one-line summary to stderr, so you can do:
//
//   node generate-notes.js --from v0.0.13 --to v0.0.14 > NOTES.md
//
// Flags:
//   --from <tag>     Starting tag (exclusive). Auto-detected (tag before --to) if omitted.
//   --to <tag>       Ending tag/ref (inclusive). Defaults to the most recent tag.
//   --enrich-prs     Replace entry text with the PR title via `gh pr view` (best-effort).
//   --help           Show usage.
'use strict';

const { execFileSync } = require('node:child_process');

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

function tryStr(fn, fallback = '') {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function parseArgs(argv) {
  const args = { from: '', to: '', enrichPrs: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--enrich-prs') args.enrichPrs = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function tagsByDate() {
  const out = tryStr(() => sh('git', ['tag', '--sort=-creatordate']));
  return out ? out.split('\n').filter(Boolean) : [];
}

function resolveRange(args) {
  const tags = tagsByDate();
  let to = args.to || tags[0] || 'HEAD';
  let from = args.from;
  if (!from) {
    const idx = tags.indexOf(to);
    if (idx >= 0 && idx + 1 < tags.length) {
      from = tags[idx + 1];
    } else if (tags.length && tags[0] !== to) {
      from = tags[0];
    } else {
      // No prior tag — fall back to the repository's first commit.
      from = tryStr(() => sh('git', ['rev-list', '--max-parents=0', 'HEAD']).split('\n').pop());
    }
  }
  return { from, to };
}

function originSlug() {
  const url = tryStr(() => sh('git', ['remote', 'get-url', 'origin']));
  if (!url) return null;
  const m = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

const US = '\x1f'; // field separator
const RS = '\x1e'; // record separator

function getCommits(from, to) {
  const range = from ? `${from}..${to}` : to;
  const fmt = ['%H', '%h', '%s', '%b'].join(US) + RS;
  const raw = tryStr(() => sh('git', ['log', `--pretty=format:${fmt}`, range]));
  if (!raw) return [];
  return raw
    .split(RS)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((rec) => {
      const [hash, short, subject, body] = rec.split(US);
      return { hash, short, subject: (subject || '').trim(), body: (body || '').trim() };
    });
}

const VERSION_RE = /^v?\d+\.\d+\.\d+/;
const MERGE_RE = /^Merge (pull request|branch|remote-tracking)/i;
const TYPE_RE = /^(\w+)(\([^)]*\))?(!)?:\s*/;
const PR_RE = /#(\d+)/;

function classify(subject) {
  const m = subject.match(TYPE_RE);
  const type = m ? m[1].toLowerCase() : '';
  if (type === 'feat' || type === 'feature') return 'Features';
  if (type === 'fix' || type === 'bugfix') return 'Fixes';
  return 'Other';
}

function cleanSubject(subject) {
  return subject.replace(TYPE_RE, '').trim();
}

function prNumber(c) {
  const m = `${c.subject} ${c.body}`.match(PR_RE);
  return m ? m[1] : null;
}

function enrichTitle(n) {
  return tryStr(() => JSON.parse(sh('gh', ['pr', 'view', n, '--json', 'title'])).title || '');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: generate-notes.js [--from <tag>] [--to <tag>] [--enrich-prs]\n');
    return;
  }

  const { from, to } = resolveRange(args);
  const slug = originSlug();
  const commits = getCommits(from, to);

  const buckets = { Features: [], Fixes: [], Other: [] };
  for (const c of commits) {
    if (!c.subject) continue;
    if (VERSION_RE.test(c.subject)) continue; // version-bump commit
    if (MERGE_RE.test(c.subject)) continue; // merge commit — content lives in its own commits
    const cat = classify(c.subject);
    let text = cleanSubject(c.subject);
    const pr = prNumber(c);
    if (args.enrichPrs && pr) {
      const title = enrichTitle(pr);
      if (title) text = title;
    }
    let line = `- ${text}`;
    if (pr && slug) line += ` ([#${pr}](https://github.com/${slug.owner}/${slug.repo}/pull/${pr}))`;
    line += ` (${c.short})`;
    buckets[cat].push(line);
  }

  const out = [];
  out.push('## Summary');
  out.push('');
  out.push('<!-- Write 1–2 sentences summarizing this release. Replace this comment. -->');
  out.push('');
  for (const name of ['Features', 'Fixes', 'Other']) {
    if (!buckets[name].length) continue;
    out.push(`### ${name}`);
    out.push(...buckets[name]);
    out.push('');
  }
  if (slug && from) {
    out.push(`**Full changelog:** https://github.com/${slug.owner}/${slug.repo}/compare/${from}...${to}`);
    out.push('');
  }

  process.stderr.write(
    `[generate-notes] range ${from || '(root)'}..${to} — ${commits.length} commits, ` +
      `${buckets.Features.length} feat / ${buckets.Fixes.length} fix / ${buckets.Other.length} other\n`,
  );
  process.stdout.write(`${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`);
}

main();
