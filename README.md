# xemu Web — Xbox Emulator in the Browser

**Play:** https://shubin123.github.io/xemu_web/

An experimental browser frontend for [xemu](https://xemu.app/), closely based on
[Shubin123/azahar_web](https://github.com/Shubin123/azahar_web). Independent of the
official xemu project. GPL-2.0-or-later.

## Run locally

```sh
npm ci
npm run build
npm start
```

Open the printed localhost URL. The repository includes a pinned runtime; no
backend checkout or compiler is needed to build the website. `app/` owns the UI,
`runtime/` owns imported artifacts, and `web/` is generated for publication.

## Console setup

Choose your MCPX boot ROM, flash BIOS, and qcow2 HDD in Console Files, then click
Load & Run. An EEPROM is optional. These files are copied into Origin Private
File System storage and reused on later visits. The HDD and EEPROM are writable
so console saves persist. Changing the active HDD keeps the old copy and its saves
in browser storage, but uses the newly selected disk for future boots.

Add local `.iso`/`.xiso` discs to the library. Search, sort, and Load & Run a disc;
Import copies it to browser storage for future visits. Unimported selections last
for this session and are read lazily. Imported copies can be deleted independently
of the original file. Imports need enough free browser storage for the file size.

Save states use ten named slots per disc/dashboard and are stored in the active
HDD. Boot the matching console and disc before restoring. Clearing the site's
browser storage deletes console files, imported discs, and saves.

## Azahar-style interface

- Xbox green, black and charcoal palette with Azahar’s raised cards, screen panel and searchable library table.
- Movable, resizable, collapsible and hideable widgets with a persisted layout drawer.
- WebGL2 renderer, 1x–4x resolution, fullscreen with Alt+Enter, and sharp/smooth display filtering.
- Four gamepads, keyboard controls, rumble and automatic/always/hidden touch controls with two analog sticks.
- AudioWorklet output, volume and buffer selection, pause/resume/reset, save slots and diagnostics.
- A green loading bar shows file import and engine download progress, then initialization until the console starts.

Xbox has one display. Azahar's dual-screen sizing and 3DS wireless lobby controls
are omitted; guest networking is unavailable in this engine. `NULL` is a CPU
diagnostic mode with no graphics, not a software GPU fallback.

## GitHub Pages

`.github/workflows/pages.yml` builds and deploys on relevant `main` pushes and
manual dispatch. All runtime inputs are hash-checked. It uses only files in this
repository and needs no private-backend token. Pages is configured to use Actions.
`coi-serviceworker.js` supplies the COOP/COEP headers needed for SharedArrayBuffer
on static hosting; a first visit reloads once when it takes control. All assets
use relative URLs so the `/xemu_web/` project path works.

The public site includes the matching engine source archive in split parts with
rebuild instructions at `source.html`; the repository can remain private.
Console firmware, discs and save data are never included in published artifacts.

## Update the engine

Build the sibling backend, then run:

```sh
npm run import:runtime -- ../xemu_emscripten
npm run build
npm test
```

The import verifies the engine build record, copies the runtime, and creates a
matching source archive from the backend's committed source. Commit `runtime/`
and the updated manifest together. Source hashes and backend/vendor commits are
recorded in `runtime/runtime.json` and the engine build record.

## Tests and support

```sh
npm test              # artifact inventory, relative URLs, WASM, media exclusion
npm run test:browser  # system Chrome; override with CHROME_PATH
npm run test:source   # offline reconstruction from the public source archive
TARGET_URL=https://shubin123.github.io/xemu_web/ npm run test:browser # live Pages checks
```

Browser tests simulate Pages without isolation headers and exercise the service
worker reload, persisted layout/library, search, mobile layout, generated firmware
execution, WebGL2 initialization, frame delivery, and OPFS snapshot save/load/delete.
The test firmware is original generated code, not console firmware.

Chrome with WebGL2, OffscreenCanvas, OPFS, WebAssembly SIMD and SharedArrayBuffer
is the supported target. Actual console BIOS, game graphics and audio compatibility
remain unverified with user-owned software. See [THIRD_PARTY.md](THIRD_PARTY.md)
for frontend attribution and the matching engine source.

For an opt-in test with your own local Xbox files, set `XEMU_DISC_PATH`,
`XEMU_MCPX_PATH`, `XEMU_FLASH_PATH`, and `XEMU_HDD_PATH`, then run
`npm run test:game`. An optional `XEMU_EEPROM_PATH` supplies your EEPROM.
Media is opened through browser file inputs in a temporary profile; only ignored
screenshots and diagnostics are written to `tests/artifacts/`. Inspect those
screenshots to distinguish game rendering from a console that merely started.

## Prepare the local NBA Live 2002 test

```sh
npm run prepare:game
npm run prepare:game -- --mcpx=/path/mcpx_1.0.bin --flash=/path/bios.bin
npm run build
npm run test:game
```

Preparation defaults to `~/Downloads/NBA Live 2002 (USA).iso` and prepares the
[official open-source Xbox HDD](https://xemu.app/docs/required-files/#hard-disk-image)
as `~/Downloads/xemu-test-hdd.qcow2` if needed. The download is pinned and checked
by SHA-256. Your MCPX dump and compatible BIOS remain required; see
[xemu's required files](https://xemu.app/docs/required-files/). Preparation checks
the Xbox disc header, MCPX size/checksum, BIOS size, and qcow2 header. BIOS size
validation alone does not establish compatibility.

Local paths are kept in ignored `tests/artifacts/game-inputs.json`. The game test
uses that manifest, saves page screenshots, captures the actual canvas separately,
and reports nonblack pixel counts. A missing input, boot failure, or completely
black captures fails the test. Nonblack pixels still need visual review to confirm
they show the game rather than a BIOS splash or error screen.

The live site's Log panel has **Download debug trace** and **Capture framebuffer**
for equivalent diagnostics. Console files must be selected there once per browser;
the website cannot read local paths from the test manifest.

Local game import accepts `.rar` as well as `.iso` and `.xiso`. Following
Azahar Web's extract-and-cache flow, RAR files are decoded in a worker and
saved as playable discs in OPFS. Archives containing an extracted game tree
(with one `default.xbe`) are converted to Xbox XDVDFS images. Reloading uses
the cached disc without extracting again. Console firmware is still required.

The library source selector includes Internet Archive's `mxogcx-xbox-ztm`
collection. Refresh its metadata with `npm run library:generate`. The full collection is visible by default, and every entry offers Play, Cache
and Choose local copy. Play reuses a cached disc across visits without downloading
or extracting it again. Archive download access errors appear in the library.
A downloaded local RAR is matched to its catalog entry automatically.
Interrupted downloads never enter the catalog.
To validate a local F1 archive without publishing media:
`XEMU_RAR_PATH=/path/to/game.rar node tests/rar-local.mjs`.
The default test exercises the normal browser quota, including session loading
when persistent storage is refused. Set `XEMU_CACHE_TEST=1` to give the isolated
test profile a 4 GiB quota and verify persistent caching separately.
Directly selected games become the active disc for Load & Run. When caching
fails, the converted disc remains playable for the current session; Cache can
be retried from the local library.

The Console Files card offers **Download & configure console files** for the
user-requested K3V1991 v1 ZIP, as well as **Download setup ZIP** and local ZIP
import. Setup reads the three members, checks CRCs, firmware hashes, sizes and
qcow2 format, and commits the browser catalog only after all imports succeed.
It installs missing files and preserves an existing HDD and its saves.
The download completes bounded 4 MiB byte ranges before decompression and
retries interrupted chunks with a timeout and backoff. A dropped connection
therefore does not discard the entire hard disk import. Cancellation stops
pending requests and retries.

The Pages workflow runs `tools/stage-console-bundle.mjs` after source checks
to fetch the checksum-pinned ZIP into ignored `web/console-files.zip`. The
site serves this compressed deployment asset from its own origin, allowing
clients to configure the console without GitHub release CORS restrictions.
No firmware or disk images are committed. To stage an already downloaded ZIP
locally after `npm run build`, use:
`node tools/stage-console-bundle.mjs --from=/path/Xbox-Emulator-Files.zip`.
Run `npm run test:console` for generated-fixture download/import, checksum
failure rollback and existing HDD preservation checks. Real console/F1
diagnostics are opt-in with
`XEMU_RAR_PATH=/path/to/game.rar node tests/console-game.mjs`; inspect its
captured frames as well as the log to assess actual gameplay.
