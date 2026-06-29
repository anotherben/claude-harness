# Frontend Patterns

Use this reference only when the main skill needs more detail for a frontend
planning, implementation, or review task.

## Decomposition Heuristics

Prefer existing repo structure. If no strong local pattern exists, start from
feature-local, single-purpose files:

- `types` or `contracts`: API DTOs, parsed view models, discriminated state,
  and props shared across the feature.
- `services` or existing client module: HTTP calls, SDK calls, external data
  access, response parsing, and service-level error contracts.
- `hooks` or use-case modules: state transitions, orchestration, derived UI
  behavior, and injected test seams.
- `components`: rendering, layout, semantic controls, local interaction state.
- `page` or composition root: route params, high-level wiring, provider context,
  and owner-level integration.

Single-use is not a reason to merge concerns. Keep a one-caller file when it owns
a distinct responsibility or proof surface. Merge only for tiny visual-only
changes or a proven local co-location pattern, and name the future extraction
seam.

## Dependency Seams

Use dependency injection when it makes behavior easier to prove:

- API clients that need mocked success/failure cases.
- Time, random, storage, feature flags, permissions, or external SDKs.
- Cross-layer contracts with more than one implementation.

Do not force DI when a local framework convention already provides a cleaner seam,
such as context providers, route loaders, query clients, server actions, or tested
module-level adapters.

## Type And Data Hazards

Check these before accepting generated UI code:

- `value || fallback` on quantities, prices, booleans, IDs, or optional text.
- API response shapes assumed from examples instead of source truth.
- Date strings displayed or compared without timezone/format ownership.
- Service failures converted into empty successful data.
- Error messages that leak implementation detail or hide actionable context.
- Unstable objects/functions in hook dependency arrays.
- Mutating arrays/objects held in React state.

## Accessibility And Interaction

For interactive UI, verify:

- Real button/input/link semantics before ARIA.
- Keyboard path for open, close, submit, cancel, and retry.
- Focus management for modals, menus, drawers, and route transitions.
- Labels or accessible names for controls.
- Disabled and pending states that prevent duplicate submit when needed.
- Error and success announcements where screen-reader feedback matters.

## Suggested A/B Forward-Test Scenarios

Use these prompts to compare behavior with and without this skill. These are
eval prompts, not proof from a completed run.

1. Plan a React add-to-cart button that calls an API and handles loading, error,
   disabled, and success states. The expected improvement is a layer map, proof
   plan, accessibility checks, single-purpose feature-local files, and no fake
   production-ready claim.
2. Review a hook that returns a fresh `actions` object and is used in a
   `useEffect` dependency array. The expected improvement is catching the render
   loop/stability risk.
3. Review a service using `quantity || 1` and returning an empty cart on failed
   add-to-cart. The expected improvement is catching falsy-value loss and
   degraded-state dishonesty.
4. Refactor a component with `fetch` in the click handler. The expected
   improvement is moving data access to the existing client/service seam without
   inventing unnecessary interfaces.
