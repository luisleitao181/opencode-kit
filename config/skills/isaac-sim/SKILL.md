---
name: isaac-sim
description: Notes for working with NVIDIA Isaac Sim / Isaac Lab (Python scripts, USD scenes, RL). Load when the task touches these simulators.
metadata:
  opencode/slash: "true"
---
## When to use
Scripts for Isaac Sim/Isaac Lab, USD scenes, sensors, ROS 2 bridge, RL training.

## Principles
- Isaac Sim uses embedded Python (`./python.sh`); confirm the version before suggesting imports.
  The API changes between versions: **always check the installed version and consult the official docs**
  (use `@researcher`) instead of assuming module names.
- Keep the control logic/policy out of simulator-specific code.
- Headless for training/CI; GUI only for debugging.
- Fix seeds and save experiment configs alongside the results.

## To complete by you (important)
- Installed Isaac Sim / Isaac Lab version and install path:
- Usual command to launch scripts:
- GPU / drivers:
