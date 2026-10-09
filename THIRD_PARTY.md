# Frontend references

The card styling in `app/style.css`, layout drawer markup in `app/index.html`,
widget layout in `app/xemu-layout.js`, and isolation service worker in
`app/coi-serviceworker.js` are adapted from the user's
[Shubin123/azahar_web](https://github.com/Shubin123/azahar_web) repository,
commit `4681213d0f471cf1d028b744373b35e653c36e98`.
The layout script's storage key and exported name are changed for xemu; the
fullscreen stage, touch controls and emulator bindings are Xbox-specific.
Azahar's networking and emulator code are not included.

The pinned engine runtime comes from
[Shubin123/xemu_emscripten](https://github.com/Shubin123/xemu_emscripten),
which contains xemu/QEMU and its source bundle/patch series under
GPL-2.0-or-later. `runtime/runtime.json` records the source commit and hashes;
`runtime/cores/xemu/xemu-core.build.json` records the vendor commit and toolchain.
The complete matching source is also downloadable from source.html on the published site.
