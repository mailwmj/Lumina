# Real-ESRGAN sidecar notices

The release bundle includes the source notices copied by
`scripts/build-realesrgan-sidecar.mjs` into `LICENSES/`.

| Component | License | Source |
| --- | --- | --- |
| Real-ESRGAN ncnn Vulkan | MIT | https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan |
| ncnn | BSD-3-Clause | https://github.com/Tencent/ncnn |
| glslang (transitive ncnn build submodule) | Multiple licenses; see bundled `LICENSES/glslang-LICENSE.txt` | https://github.com/KhronosGroup/glslang |
| libwebp | BSD-3-Clause | https://github.com/webmproject/libwebp |
| MoltenVK (macOS static link) | Apache-2.0 | https://github.com/KhronosGroup/MoltenVK |
| `realesrgan-x4plus` model asset | BSD-3-Clause at the upstream repository level; no separate model-asset license declaration | https://github.com/xinntao/Real-ESRGAN |

The exact sources, versions, and checksums are recorded in
`scripts/realesrgan-sidecar.lock.json` and in the bundled `manifest.json`.
Any model redistribution review must use those records rather than treating a
third-party repackaging as the source of truth.

## Pinned distribution inputs

- Engine source: `v0.2.0` / `37026f4`,
  `https://codeload.github.com/xinntao/Real-ESRGAN-ncnn-vulkan/tar.gz/v0.2.0`,
  SHA-256 `346663b1924b2a1bfa655d656bfbba6b09f76ff75e4eee9d1fff4bfdef8b5712`.
- Engine submodules: ncnn `6125c9f47cd14b589de0521350668cf9d3d37e3c` and libwebp
  `8ea81561d2fdd382da60f57958741a7c23a18eb6`.
- Model source: `v0.2.5.0`,
  `https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/Real-ESRGAN-v0.2.5.0-models.tar.xz`,
  SHA-256 `1c858d2d0a0500735852c0559bf29e868aae5dbd1aff7f5900688701bee1264a`.
- Bundled model files: `realesrgan-x4plus.param` SHA-256
  `35330ececcea33b6c397a72548e788d5d53becee4734c50b7fada36e89f10a86`;
  `realesrgan-x4plus.bin` SHA-256
  `713ee713b0353afaa27976f0563a64a5043bd70b9bd8936c2e26e25ebcdbcddf`.
- Windows Vulkan build toolchain: Vulkan SDK `1.4.341.0`,
  `https://sdk.lunarg.com/sdk/download/1.4.341.0/windows/vulkansdk-windows-X64-1.4.341.0.exe`,
  SHA-256 `5072ac63f0b00bc8c132bc0052bac0456f61983bd9d5dd50f614e190472db875`.
- macOS static Vulkan implementation: Vulkan SDK `1.4.341.0`,
  `https://sdk.lunarg.com/sdk/download/1.4.341.0/mac/vulkansdk-macos-1.4.341.0.zip`,
  SHA-256 `3b8af7f7db74b4bda02dc91503cec288ab70aebfe273ff98bb8cebabf04b196e`.

LunarG publishes the two SDK artifact hashes through its versioned SHA endpoint;
the CI workflow independently compares downloaded bytes with the lock values.
