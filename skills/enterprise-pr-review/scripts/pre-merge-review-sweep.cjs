#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');

function usage() {
  console.error('Usage: pre-merge-review-sweep.cjs <pr-number-or-url> [--allow-closed]');
  process.exit(2);
}

const args = process.argv.slice(2);
const pr = args.find((arg) => !arg.startsWith('--'));
const allowClosed = args.includes('--allow-closed');

if (!pr) usage();

function gh(argsForGh) {
  return execFileSync('gh', argsForGh, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function parseJson(commandArgs) {
  const output = gh(commandArgs);
  return output ? JSON.parse(output) : null;
}

function isPassingConclusion(conclusion) {
  return ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(String(conclusion || '').toUpperCase());
}

function normalizeCheck(check) {
  return {
    name: check.name || check.context || 'unknown-check',
    status: String(check.status || check.state || '').toUpperCase(),
    conclusion: String(check.conclusion || check.state || '').toUpperCase(),
    workflowName: check.workflowName || null,
    completedAt: check.completedAt || null,
    startedAt: check.startedAt || null,
  };
}

function checkKey(check) {
  return `${check.name}\u0000${check.workflowName || ''}`;
}

function checkTimestamp(check) {
  const value = Date.parse(check.completedAt || check.startedAt || '');
  return Number.isFinite(value) ? value : 0;
}

function latestChecks(checks) {
  const byKey = new Map();
  for (const check of checks) {
    const key = checkKey(check);
    const current = byKey.get(key);
    if (!current || checkTimestamp(check) >= checkTimestamp(current)) {
      byKey.set(key, check);
    }
  }
  return [...byKey.values()];
}

const prView = parseJson([
  'pr',
  'view',
  pr,
  '--json',
  'number,url,state,baseRefName,headRefName,headRefOid,mergeStateStatus,reviewDecision,statusCheckRollup',
]);

if (!allowClosed && prView.state !== 'OPEN') {
  console.error(`BLOCKED: PR #${prView.number} is ${prView.state}, not OPEN.`);
  process.exit(1);
}

const checks = latestChecks((prView.statusCheckRollup || []).map(normalizeCheck));
const incompleteChecks = checks.filter((check) => (
  check.status && !['COMPLETED', 'SUCCESS'].includes(check.status)
));
const failedChecks = checks.filter((check) => (
  ['COMPLETED', 'SUCCESS'].includes(check.status) && !isPassingConclusion(check.conclusion)
));
const reviewChecks = checks.filter((check) => (
  /review|claude|copilot/i.test(`${check.name} ${check.workflowName || ''}`)
));
const incompleteReviewChecks = reviewChecks.filter((check) => (
  check.status && !['COMPLETED', 'SUCCESS'].includes(check.status)
));

const threadQuery = `
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first:1) {
            nodes {
              databaseId
              author { login }
              body
              url
            }
          }
        }
      }
    }
  }
}`;

const repo = gh(['repo', 'view', '--json', 'owner,name']);
const repoInfo = JSON.parse(repo);
const threadResult = parseJson([
  'api',
  'graphql',
  '-f',
  `owner=${repoInfo.owner.login}`,
  '-f',
  `name=${repoInfo.name}`,
  '-F',
  `number=${prView.number}`,
  '-f',
  `query=${threadQuery}`,
]);
const threads = threadResult.data.repository.pullRequest.reviewThreads.nodes || [];
const unresolvedThreads = threads.filter((thread) => !thread.isResolved);

const blockers = [];
if (incompleteChecks.length > 0) {
  blockers.push(`checks still running: ${incompleteChecks.map((check) => check.name).join(', ')}`);
}
if (failedChecks.length > 0) {
  blockers.push(`checks failed: ${failedChecks.map((check) => `${check.name}:${check.conclusion}`).join(', ')}`);
}
if (reviewChecks.length === 0) {
  blockers.push('no async review checks found; request or confirm review before merge');
}
if (incompleteReviewChecks.length > 0) {
  blockers.push(`review checks still running: ${incompleteReviewChecks.map((check) => check.name).join(', ')}`);
}
if (unresolvedThreads.length > 0) {
  blockers.push(`unresolved review threads: ${unresolvedThreads.length}`);
}

if (blockers.length > 0) {
  console.error(`BLOCKED: PR #${prView.number} is not merge-ready.`);
  for (const blocker of blockers) {
    console.error(`- ${blocker}`);
  }
  for (const thread of unresolvedThreads) {
    const comment = thread.comments.nodes[0] || {};
    console.error(`- thread ${thread.id} ${thread.path || '(file)'}:${thread.line || '?'} ${comment.author?.login || 'unknown'} ${comment.url || ''}`);
  }
  process.exit(1);
}

console.log(`PASS pre-merge review sweep: PR #${prView.number} ${prView.headRefOid}`);
console.log(`checks=${checks.length} reviewChecks=${reviewChecks.length} unresolvedThreads=0 state=${prView.state}`);
