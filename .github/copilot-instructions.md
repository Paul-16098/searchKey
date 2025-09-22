# Copilot instructions for searchKey

This repo injects a searchable index of runtime objects into a web page and exposes `$searchKey()` to locate values/functions across globals and framework-attached nodes.

## Big picture
- Entry: `main.ts` (browser-only; uses `document`/`window`). No bundler here.
- Flow: (1) create a hidden `<iframe>` to obtain pristine built-ins; (2) diff `window` vs `contentWindow` to list extra globals by type; (3) traverse those globals with `KeyCollector` to record access paths like `window['Foo']['bar']`; (4) scan DOM nodes for Vue/React roots via props starting with `__vue*` / `__react*`; (5) expose `$searchKey(key, fuzzy)`.

## Key constructs
- `newEval(code, safety=true)`: wrapper around `new Function`; when reading values it uses `safety=false` with `return <path>`. A blacklist guards obvious dangerous tokens.
- `KeyCollector(ignoreProps)`: traverses objects using `WeakMap` to avoid cycles, skips `Node` instances and `Promise`s, and builds stable bracket-notation paths.
- Ignore sets: common (`length`, `arguments`, `caller`, `prototype`, `constructor`), Vue (`__ob__`, `$options`, `_$vnode`), React (`memoizedState`, `updateQueue`, `refs`, `context`).
- `MAX_DEPTH` (default `Infinity`) bounds traversal; lower it for speed/memory.

## Using `$searchKey`
- Exact: `$searchKey('fetch')` → array of `{ path, code }` (e.g., `window['fetch']`).
- Fuzzy: `$searchKey('react', true)` matches keys case-insensitively across globals/Vue/React. Native functions are filtered out.

## Build & run
- `tsconfig.json`: `target: ESNext`, `module: commonjs`, `sourceMap: true`, `outDir: "."`.
- Note: `jsconfig.json` lists `outDir: "dist"`; prefer `tsconfig.json` when compiling TS.
- Workflow: compile `main.ts` to JS and load it into a page (paste into DevTools, userscript, or extension) to register `$searchKey`.

## Conventions & gotchas
- Traversal catches property access errors; DOM `Node`s skipped; `Promise`s ignored (rejections swallowed).
- Paths use bracket notation to support numeric/special keys.
- Performance: reduce `MAX_DEPTH`, extend ignore sets for app internals, and avoid scanning overly large DOMs.

## Extend
- To support other frameworks, add a new ignore set and mirror the Vue/React discovery pattern at their attachment points.
