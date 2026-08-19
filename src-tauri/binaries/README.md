# Bundled sidecars

Generated sidecars are not checked in. Real-ESRGAN uses Tauri's external binary
naming convention:

```text
realesrgan-ncnn-vulkan-x86_64-pc-windows-msvc.exe
realesrgan-ncnn-vulkan-aarch64-apple-darwin
realesrgan-ncnn-vulkan-x86_64-apple-darwin
```

For a universal macOS app, the build script creates both target-suffixed files
from one `lipo`-verified universal executable. Tauri selects the matching
target-suffixed name while bundling.
