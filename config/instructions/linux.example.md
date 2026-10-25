# Machine facts: Linux / WSL

Replace the examples below with this machine's real values. `scripts/install.sh` copies
`linux.local.md` when present; otherwise it copies this file.

- The shell is bash. Use `python3` and isolated `venv` or `uv` environments; never install
  project packages globally. Run tests with `python3 -m pytest`.
- Distribution and Python version: <!-- e.g. Ubuntu 24.04, Python 3.12 -->
- ROS distribution and setup file: <!-- e.g. Humble, /opt/ros/humble/setup.bash; or "none" -->
- Node.js / npm: <!-- version, install method, or "not installed" -->
- C/C++ toolchain: <!-- e.g. GCC, CMake and Make installed -->
- Keep active projects in the Linux filesystem (`~/...`), not under `/mnt/c/...`, especially
  when using the sandbox. Use a native Linux copy of this kit and run `scripts/install.sh`.
- Run the native Linux `opencode` binary from the terminal. `command -v opencode` must return a
  Linux path, not `/mnt/c/.../npm/opencode`.
- Throwaway scratch work lives under `/tmp/opencode/<name>` and may be deleted when finished.
- The `playwright` and `memory` MCP servers require native Node.js/npx. If Node is not installed,
  leave those servers unused; `context7` and `exa` are remote and do not require Node.
