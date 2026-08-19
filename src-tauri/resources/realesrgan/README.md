# Real-ESRGAN bundle resources

The build scripts materialize exactly two model files here:

```text
models/realesrgan-x4plus.param
models/realesrgan-x4plus.bin
```

They are intentionally not committed. `scripts/realesrgan-sidecar.lock.json` is
the source of truth for the model source, version, sizes, and SHA-256 values.
`manifest.json` is bundled with the files so the runtime can validate the model
identity without accepting a user-selected model path.

Run `npm run realesrgan:sidecar -- --target <tauri-target-triple>` to create the
resources and the matching sidecar. The script downloads the model archive,
checks its SHA-256, extracts only the two declared model files, and checks each
file's size and SHA-256. It never copies an upstream executable into this
repository.

`npm run tauri -- build` always builds and verifies this contract. `npm run
tauri -- dev` deliberately does not download or compile it: it verifies an
already-built contract when present, otherwise starts normally and upscale
requests report `sidecar_unavailable`. Use the explicit sidecar command above
when working on upscaling locally.

`LICENSES/` and `build-metadata.json` are generated at build time. The former
contains upstream notices copied from the pinned source checkouts; the latter
records the actual build target, binary SHA-256, and resolved submodule commits.
