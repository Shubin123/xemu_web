# xemu_web

Experimental Xbox browser frontend for the sibling `xemu_emscripten` backend.
Independent of the official xemu project. GPL-2.0-or-later.

Build the backend first, then:

```sh
npm run build
npm start
```

Open the printed localhost URL. The build copies `app/` and the backend runtime
into `web/`. Supply a local MCPX ROM, flash BIOS, and qcow2 HDD. The HDD is copied
to Origin Private File System storage and reused on later boots; selecting another
HDD replaces that copy. Discs are read lazily and selected per session. Saves reside
in the browser HDD; clearing site storage deletes them. Firmware, discs and save
data are never included in the repository.

Chrome with WebGL2, OffscreenCanvas, OPFS and SharedArrayBuffer is required.
The development server supplies COOP/COEP headers. Static deployment must also
provide isolation (or an isolation service worker). No deployment is configured yet.

The frontend supports gamepads, keyboard input, volume, pause/resume, resolution,
disc insertion and snapshot save/load/delete. Real BIOS/dashboard/game boot,
audio and GPU compatibility require validation with user-owned files.
