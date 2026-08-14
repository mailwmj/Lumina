fn main() {
    println!(
        "cargo:rustc-env=LUMINA_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("Cargo TARGET is unavailable")
    );
    tauri_build::build()
}
