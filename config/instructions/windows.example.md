# Machine facts: native Windows

Replace the examples below with this machine's real values. `scripts/install.ps1` copies
`windows.local.md` when present; otherwise it copies this file.

- The shell is PowerShell. Use native Windows paths and commands; GNU coreutils are not
  guaranteed. Prefer OpenCode's read/grep/glob tools over shell equivalents.
- Python: <!-- e.g. 3.13 as `python` and the `py` launcher; always `python -m pytest` -->
- Node.js / npm: <!-- version, or "not installed" -->
- C/C++ toolchain: <!-- e.g. none; use WSL for GCC/CMake -->
- ROS: <!-- e.g. none on Windows; ROS 2 Humble in WSL Ubuntu 22.04 -->
- Java / .NET / other toolchains: <!-- versions or "not installed" -->
- Throwaway scratch work lives under `%TEMP%\opencode\<name>` and may be deleted when finished.
- Run the native Windows `opencode` binary from PowerShell or the VS Code PowerShell terminal,
  in the project folder. Do not invoke this binary from a WSL shell.
