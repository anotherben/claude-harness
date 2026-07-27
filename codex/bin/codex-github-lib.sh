#!/usr/bin/env bash

_codex_github_lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
CODEX_HOME_DIR="${CODEX_HOME_DIR:-$(cd "${_codex_github_lib_dir}/.." && pwd -P)}"
CODEX_USER_HOME_DIR="${CODEX_USER_HOME_DIR:-$(cd "${CODEX_HOME_DIR}/.." && pwd -P)}"

codex_github_print_setup_help() {
  cat >&2 <<'EOF'
Codex GitHub PR identity is not configured.

Set up a separate GitHub account for Codex, add it to anotherben/helpdesk with
write access, then store its token in one of these places:

  security add-generic-password -a codex -s codex-github-pr-token -w '<token>' -U

or export for the current shell/session:

  export CODEX_PR_GITHUB_TOKEN='<token>'

The token must not belong to anotherben. Classic PAT scopes: repo, workflow.
Fine-grained token permissions: Contents read/write, Pull requests read/write,
Actions read, Workflows read/write.

If Ben has explicitly allowed same-account PR creation for this machine, create
~/.codex/allow-ben-pr-account and either provide CODEX_GITHUB_PERSONAL_ACCESS_TOKEN
or make sure `gh auth token` works for the local anotherben login. The PR wrapper
will still generate/validate required PR body sections before opening the PR.
EOF
}
codex_github_ben_account_allowed() {
  [[ "${CODEX_ALLOW_BEN_PR_ACCOUNT:-}" == "1" || "${CODEX_ALLOW_BEN_PR_ACCOUNT:-}" == "true" ]] \
    || [[ -f "${CODEX_HOME_DIR}/allow-ben-pr-account" ]] \
    || [[ -n "${HOME:-}" && -f "${HOME}/.codex/allow-ben-pr-account" ]]
}

codex_github_token_is_placeholder() {
  local value="${1:-}"
  [[ -z "${value}" || "${value}" == \<* || "${value}" == "token" || "${value}" == "TODO"* ]]
}

codex_github_load_token() {
  local secrets_file="${CODEX_SECRETS_ENV_FILE:-${CODEX_HOME_DIR}/secrets/helpdesk-github.env}"
  if [[ -r "${secrets_file}" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "${secrets_file}"
    set +a
  fi

  CODEX_GH_TOKEN_VALUE="${CODEX_PR_GITHUB_TOKEN:-${CODEX_GITHUB_PR_TOKEN:-}}"

  if codex_github_token_is_placeholder "${CODEX_GH_TOKEN_VALUE}"; then
    CODEX_GH_TOKEN_VALUE=""
  fi

  if [[ -z "${CODEX_GH_TOKEN_VALUE}" ]] && command -v security >/dev/null 2>&1; then
    CODEX_GH_TOKEN_VALUE="$(security find-generic-password -a codex -s codex-github-pr-token -w 2>/dev/null || true)"
    if codex_github_token_is_placeholder "${CODEX_GH_TOKEN_VALUE}"; then
      CODEX_GH_TOKEN_VALUE=""
    fi
  fi

  if [[ -z "${CODEX_GH_TOKEN_VALUE}" ]] && command -v security >/dev/null 2>&1; then
    CODEX_GH_TOKEN_VALUE="$(security find-generic-password -a codex-pr -s codex-github-token -w 2>/dev/null || true)"
    if codex_github_token_is_placeholder "${CODEX_GH_TOKEN_VALUE}"; then
      CODEX_GH_TOKEN_VALUE=""
    fi
  fi

  if [[ -z "${CODEX_GH_TOKEN_VALUE}" ]] \
    && codex_github_ben_account_allowed \
    && [[ -n "${CODEX_GITHUB_PERSONAL_ACCESS_TOKEN:-}" ]]; then
    CODEX_GH_TOKEN_VALUE="${CODEX_GITHUB_PERSONAL_ACCESS_TOKEN}"
  fi

  if [[ -z "${CODEX_GH_TOKEN_VALUE}" ]] \
    && codex_github_ben_account_allowed \
    && command -v gh >/dev/null 2>&1; then
    CODEX_GH_TOKEN_VALUE="$(gh auth token 2>/dev/null || true)"
    if codex_github_token_is_placeholder "${CODEX_GH_TOKEN_VALUE}" \
      && [[ -d "${CODEX_USER_HOME_DIR}/.config/gh" ]]; then
      CODEX_GH_TOKEN_VALUE="$(HOME="${CODEX_USER_HOME_DIR}" gh auth token 2>/dev/null || true)"
    fi
  fi

  if [[ -z "${CODEX_GH_TOKEN_VALUE}" ]]; then
    codex_github_print_setup_help
    return 64
  fi
}
codex_github_verify_token() {
  local login expected forbidden
  if ! login="$(GH_TOKEN="${CODEX_GH_TOKEN_VALUE}" gh api user --jq .login 2>/dev/null)"; then
    echo "Codex GitHub token could not authenticate with GitHub." >&2
    codex_github_print_setup_help
    return 65
  fi

  if [[ -z "${login}" || ! "${login}" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$ ]]; then
    echo "Codex GitHub token could not authenticate with GitHub." >&2
    codex_github_print_setup_help
    return 65
  fi

  forbidden="${BEN_GITHUB_LOGIN:-anotherben}"
  if [[ "${login}" == "${forbidden}" ]]; then
    if codex_github_ben_account_allowed; then
      echo "Using ${login} for Codex PR creation because same-account PR creation is explicitly allowed on this machine." >&2
      CODEX_GH_LOGIN="${login}"
      return 0
    fi

    cat >&2 <<EOF
Refusing to use GitHub token for ${login}.

Codex PRs must be authored by a separate GitHub identity so ${forbidden} can
review and approve them. Configure CODEX_PR_GITHUB_TOKEN or the keychain item
with a token from the Codex/machine user instead.
EOF
    return 66
  fi

  expected="${CODEX_GITHUB_LOGIN:-}"
  if [[ -n "${expected}" && "${login}" != "${expected}" ]]; then
    echo "Codex GitHub token login is ${login}, expected ${expected}." >&2
    return 67
  fi

  CODEX_GH_LOGIN="${login}"
}
