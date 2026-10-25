---
name: unity
description: Notes for Unity projects (C#), incl. robotics simulation (e.g. Unity Robotics Hub / ROS-TCP).
metadata:
  opencode/slash: "true"
---
## When to use
C# scripts in Unity, physics/ArticulationBody, communication with ROS 2.

## Principles
- Physics in `FixedUpdate`, input/UI in `Update`; avoid per-frame allocations.
- Prefer `ArticulationBody` for robot kinematic chains.
- Don't edit `.meta`/`Library/`/`Temp/` files by hand.
- Confirm the Unity version and packages before suggesting APIs (use `@researcher`).

## To complete by you
- Unity version, robotics packages used:
