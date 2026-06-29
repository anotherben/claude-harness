# GitHub Closeout Recipes

Use `--repo anotherben/helpdesk` on every `gh` command.

## Oldest-First Queue

```bash
git fetch origin --prune
gh pr list --repo anotherben/helpdesk --base dev --state open \
  --json number,title,url,author,createdAt,baseRefName,headRefName,headRepository,headRepositoryOwner,headRefOid,isDraft,maintainerCanModify,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup \
  --jq 'sort_by(.createdAt)[]'
```

## Per-PR Metadata

```bash
gh pr view --repo anotherben/helpdesk <PR> \
  --json number,title,url,author,baseRefName,headRefName,headRepository,headRepositoryOwner,headRefOid,isDraft,maintainerCanModify,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,files

gh pr checks --repo anotherben/helpdesk --required <PR>
```

## Review Threads

Use paginated GraphQL. Counts alone are not enough.

```bash
gh api graphql --paginate -f owner=anotherben -f name=helpdesk -F number=<PR> -f query='
query($owner:String!, $name:String!, $number:Int!, $endCursor:String) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      headRefOid
      reviewThreads(first:100, after:$endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          subjectType
          comments(first:20) {
            nodes {
              id
              author { login }
              url
              body
              createdAt
            }
          }
        }
      }
    }
  }
}'
```

Record the query timestamp, `headRefOid`, unresolved thread IDs, URLs, paths, and
risk themes in the PR report.

Reply on the exact review thread. If the available tooling cannot target the thread
reliably, stop and report the exact missing operation instead of posting a top-level
comment as if the thread were addressed.

## Review Wait

Run after the final push/reply cycle and before the final review-thread query:

```bash
node scripts/review/copilot-review-wait.cjs --repo anotherben/helpdesk --pr <PR>
```

## Merge

Only after current-head gates pass and Ben currently authorized merge:

```bash
gh pr merge --repo anotherben/helpdesk --rebase <PR>
git fetch origin --prune
git merge-base --is-ancestor <merge-or-head-sha> origin/dev
```

Never use `--auto`, `--admin`, or direct pushes to `main`.

## Follow-Up Issues

Create only real non-blocking follow-ups. Do not create issues for `note-only`
observations. Include owner, scope, proof target, and source artifact links.

```bash
gh issue create --repo anotherben/helpdesk \
  --title "<short follow-up title>" \
  --label "follow-up" \
  --body "$(cat <issue-body.md>)"
```

If issue creation fails, block merge-ready/merge or get an explicit Ben exception.
