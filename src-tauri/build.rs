fn main() {
    // rust-embed 在编译期嵌入远程面板产物（../dist-remote/）。该目录是构建产物、
    // 不入库；这里确保它至少存在，使独立 `cargo check`/`cargo build` 不因缺目录而失败
    // （正式构建由 beforeBuildCommand 的 pnpm build 先填充真实文件）。
    let _ = std::fs::create_dir_all("../dist-remote");
    tauri_build::build()
}
