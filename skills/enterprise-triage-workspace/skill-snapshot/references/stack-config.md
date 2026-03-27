# Stack Config — Parameterization System

Enterprise skills MUST NOT hardcode project paths, commands, or conventions.
Use the variables below, resolved at skill invocation time.

---

## 1. Resolution Order

1. **`project-profile.md`** — output of `enterprise-discover`. If present at `$PROJECT_ROOT/.claude/project-profile.md`, parse it as the authoritative source. It contains all variables pre-resolved.
2. **Auto-detection** — if no profile exists, detect each variable using the rules in section 3.
3. **Defaults** — if detection finds nothing, use the default value listed below.

Skills should resolve config once at the start of execution, not per-step.

---

## 2. Variable Definitions

| Variable | Description | Default |
|---|---|---|
| `$PROJECT_ROOT` | Git repo root or cwd | `git rev-parse --show-toplevel` |
| `$SOURCE_DIR` | Primary source directory (relative to root) | `src` |
| `$TEST_DIR` | Test directory (relative to root) | `tests` |
| `$FRONTEND_DIR` | Frontend app directory (relative to root), empty if none | _(empty)_ |
| `$TEST_COMMAND` | Command to run tests from project root | `npx jest` |
| `$BUILD_COMMAND` | Command to build the project, empty if interpreted | _(empty)_ |
| `$LINT_COMMAND` | Command to lint, empty if none configured | _(empty)_ |
| `$AUTH_MIDDLEWARE` | Name of the auth middleware/decorator function | _(empty)_ |
| `$TENANT_FIELD` | Multi-tenant column name, `none` if single-tenant | `none` |
| `$DB_TYPE` | Database engine | `postgresql` |
| `$MIGRATION_DIR` | Migration files directory (relative to root) | _(empty)_ |
| `$MIGRATION_RUNNER` | Command to run migrations | _(empty)_ |
| `$BRANCH_MAIN` | Default working branch | `main` |
| `$BRANCH_PROTECTED` | Comma-separated branches that must never receive direct pushes | `main` |
| `$FILE_EXTENSIONS` | Comma-separated source file extensions | `.js,.ts` |

---

## 3. Auto-Detection Rules

### $PROJECT_ROOT
```
git rev-parse --show-toplevel
```
Fallback: current working directory.

### $SOURCE_DIR
Check in order, first match wins:
1. `apps/*/src/` — monorepo (use the backend app, e.g., `apps/api/src`)
2. `src/` — standard layout
3. `lib/` — Ruby/Elixir convention
4. `.` — flat layout (source at root)

For monorepos with multiple apps, prefer the **backend/API** app.

### $TEST_DIR
Check in order:
1. `$SOURCE_DIR/__tests__/` — co-located tests
2. `tests/` or `test/` at project root
3. `spec/` — Ruby/RSpec convention

### $FRONTEND_DIR
Check in order:
1. `apps/admin/`, `apps/web/`, `apps/frontend/` — monorepo
2. `frontend/`, `client/`, `web/` — standalone

Empty if no frontend detected.

### $TEST_COMMAND
Detect from config files:
| Found | Command |
|---|---|
| `jest.config.*` or `jest` key in `package.json` | `npx jest` |
| `vitest.config.*` | `npx vitest run` |
| `pytest.ini`, `pyproject.toml` with `[tool.pytest]` | `pytest` |
| `Gemfile` with `rspec` | `bundle exec rspec` |
| `go.mod` | `go test ./...` |
| `Cargo.toml` | `cargo test` |

### $BUILD_COMMAND
| Found | Command |
|---|---|
| `vite.config.*` | `npx vite build` |
| `next.config.*` | `npx next build` |
| `webpack.config.*` | `npx webpack` |
| `tsconfig.json` (no bundler) | `npx tsc` |
| `Makefile` with `build` target | `make build` |
| `Cargo.toml` | `cargo build` |

If frontend is separate, prefix with `cd $FRONTEND_DIR &&`.

### $LINT_COMMAND
| Found | Command |
|---|---|
| `.eslintrc*` or `eslint` in `package.json` | `npx eslint` |
| `biome.json` | `npx biome check` |
| `.rubocop.yml` | `rubocop` |
| `pyproject.toml` with `[tool.ruff]` | `ruff check` |
| `setup.cfg` with `flake8` | `flake8` |
| `.golangci.yml` | `golangci-lint run` |

### $AUTH_MIDDLEWARE
Search source files for common patterns:
- JS/TS: `module.exports.*authenticate`, `export.*authMiddleware`, `export.*requireAuth`
- Python: `@login_required`, `@auth_required`, `IsAuthenticated`
- Ruby: `before_action :authenticate`

Use the function/decorator name found. Empty if none detected.

### $TENANT_FIELD
Search migration files and models for multi-tenant columns:
- `tenant_id`, `organization_id`, `org_id`, `account_id`, `company_id`, `workspace_id`
- `none` if no tenant scoping found.

### $DB_TYPE
| Found | Type |
|---|---|
| `pg` in `package.json` or `psycopg` in requirements | `postgresql` |
| `mysql2` or `mysqlclient` | `mysql` |
| `better-sqlite3` or `sqlite3` | `sqlite` |
| `mongoose` or `pymongo` | `mongodb` |

### $MIGRATION_DIR
Check in order:
1. `database/migrations/`, `db/migrations/` — JS convention
2. `db/migrate/` — Rails
3. `alembic/versions/` — Python/Alembic
4. `migrations/` — Django, generic

Relative to `$SOURCE_DIR` parent or project root.

### $MIGRATION_RUNNER
| DB Type / Framework | Runner |
|---|---|
| Raw SQL + PostgreSQL | `psql` |
| Knex | `npx knex migrate:latest` |
| Rails | `rails db:migrate` |
| Alembic | `alembic upgrade head` |
| Django | `python manage.py migrate` |

### $BRANCH_MAIN / $BRANCH_PROTECTED
```
git remote show origin | grep 'HEAD branch'
```
Check for branch protection rules in `.claude/context-inject.json` or repo conventions.

### $FILE_EXTENSIONS
Detect from `$SOURCE_DIR` contents:
| Dominant files | Extensions |
|---|---|
| `.js`, `.jsx` | `.js,.jsx` |
| `.ts`, `.tsx` | `.ts,.tsx` |
| `.py` | `.py` |
| `.rb`, `.erb` | `.rb,.erb` |
| `.go` | `.go` |
| `.rs` | `.rs` |

---

## 4. Usage in Skills

Skills reference variables using `$VARIABLE_NAME` syntax in their instructions.
At runtime, the skill resolves each variable before executing commands.

**Before (hardcoded):**
```
cd /home/clawdbot/clawd/cortex && npx jest apps/api/src/__tests__/
```

**After (parameterized):**
```
cd $PROJECT_ROOT && $TEST_COMMAND $TEST_DIR/
```

**Pattern for guards:**
```
# Only if multi-tenant
if $TENANT_FIELD != "none":
  verify every INSERT includes $TENANT_FIELD
  verify every SELECT scopes by $TENANT_FIELD

# Only if auth middleware exists
if $AUTH_MIDDLEWARE != "":
  verify protected routes use $AUTH_MIDDLEWARE
```

---

## 5. Fallback Behavior

When detection fails for a variable:

- **Critical** (`$PROJECT_ROOT`, `$SOURCE_DIR`, `$FILE_EXTENSIONS`): Ask the user. Do not guess.
- **Command variables** (`$TEST_COMMAND`, `$BUILD_COMMAND`, `$LINT_COMMAND`, `$MIGRATION_RUNNER`): Skip steps that require the command. Log a warning: `"[stack-config] Could not detect $VAR — skipping step."`.
- **Optional** (`$FRONTEND_DIR`, `$AUTH_MIDDLEWARE`, `$TENANT_FIELD`): Use default (empty/none). Skills must handle the empty case with conditional logic, not errors.
- **Never fabricate** a value. An empty variable is safer than a wrong one.
