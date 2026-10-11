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

RAR import follows Azahar Web's extract-and-cache interaction. Decoding uses
[node-unrar-js](https://github.com/YuJianrong/node-unrar.js) 2.0.2 (MIT), with
UnRAR 6.1.7 compiled to WASM. Both license texts are preserved in
`app/vendor/unrar/`. Relative ESM imports have `.js` extensions added for
native browser loading; no CDN or build-time decoder download is needed.
The npm release tarball SHA-1 is `03ef602052497263b9aed8ff1e7afb315024f9ec`.
The Xbox XDVDFS builder and OPFS integration are specific to this frontend.
