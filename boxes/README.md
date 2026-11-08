# Boxes and wiring

The site is divided into **boxes**. Each box is one function of the business or the site: taking an enquiry, the packaging catalogue, the mockup studio, staff sign-in. A box holds everything that function needs: its server code, its screens, its tests and its data files.

**To see them:** open [`map.html`](map.html) in a browser and choose a box, or read [`MAP.md`](MAP.md).

## What is where

| | |
| --- | --- |
| `boxes/parts/<id>.json` | One file per box: what it does, its files, its data, and which boxes it connects to. **These are the ones you edit.** |
| `server.js` | The wiring. One line per box, handing it what it needs from the boxes above. No logic. |
| `lib/<box>.js` | A box's server code, starting with `export function registerSomething(app, wires)`. |
| `boxes/wiring.json`, `MAP.md`, `map.html` | The saved map, generated. Never edit these by hand. |

Fields in a box definition: `id`, `name`, `does` (one plain sentence), `kind`, `plugged` (true if `server.js` plugs it in), `files`, `tests` (or `checkedBy` saying how it is checked), `uses` (the boxes it connects to), `data` (data files it owns), `reads` (another box's data it only reads), `settings` (plain values it is handed, not offered by any box).

## The rule

**A new function gets its own box and its own wiring.** The tests enforce it: `npm test` fails if a file is in no box, a connection is not declared, a route has no owner, a screen calls a route that does not exist, or the saved map is out of date.

## Adding a function

```bash
npm run box:new -- price-list "Publishes the price list"
```

That creates the definition, the module and a test, and plugs the box into `server.js`. Then:

1. Write the code in `lib/price-list.js`. Add any screens or scripts it needs and list them under `files`.
2. In `server.js`, hand it the wires it needs: `plug('price-list', registerPriceList, { readJsonFile, adminAuth })`. Only what is already plugged in above it can be handed over.
3. Return what other boxes may use: `return { priceOf };`
4. List the boxes it connects to under `uses`, and its data files under `data`.
5. Replace the placeholder test with what the box must really do (the check fails until you do).
6. Run `npm run boxes` to save the map, then `npm test`.

## Changing something

Find the box in the map; everything it touches is listed there. If you connect two boxes that were not connected, add the word to `uses`: that one-word edit is the point, because a new dependency should be a decision. Then run `npm run boxes`.

`npm run boxes:check` tells you, in plain sentences, anything that no longer matches.

## How boxes connect

| Connection | Example | How it is found |
| --- | --- | --- |
| **A wire** | `email` is handed `adminAuth` | Recorded from the running app by `lib/board.js` |
| **An import** | `branding` imports `lib/image-upload.js` | Read from the code |
| **A call** | the inbox screen calls `/api/team/inquiries` | Read from the code and matched to a real route |
| **An event** | the studio sends `studio:drawn` | Read from the code |
| **Data** | `team.json` belongs to `staff-accounts` | Each data file has one owner |

## Keep in mind

- **Order matters in `server.js`.** Express runs routes and guards in the order they are added. The guards go first and `static-site` goes last, or the 404 page answers before your route does.
- **Server code must not import from `src/`.** The Docker image does not contain it. Shared rules go in `lib/`, which the pages can import too.
- **A box reads the environment when it is plugged in, not when it is imported,** because `server.js` loads `.env` first.
- A few wires wait on a box plugged in later (`later(...)` in `server.js`). They only run once the site is up; the map marks them "once running".

## Why it is built this way

Researched before the split, November 2026.

- One place connects everything, close to the entry point: the [Composition Root](https://blog.ploeh.dk/2011/07/28/CompositionRoot/). Plain function calls were chosen over a container, so a problem at start-up reads like any other.
- [Express runs middleware in load order](https://expressjs.com/en/guide/writing-middleware.html), so behaviour was recorded for every route and role before the split and compared after every step.
- Boundaries erode unless a check enforces them. [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) is the usual tool, but it only sees imports. This check also sees which box was really handed which wire, which route belongs to whom and whether each call reaches a route, with no new dependency on a host with a tight memory cap.
- One model, generated views, so the map cannot drift from the code: the idea behind [Structurizr's models as code](https://docs.structurizr.com/as-code).
