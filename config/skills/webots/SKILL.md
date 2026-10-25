---
name: webots
description: Notes for Webots controllers and worlds in Python, incl. ROS 2 integration.
metadata:
  opencode/slash: "true"
---
## When to use
Python controllers for Webots, `.wbt` files, `webots_ros2` integration.

## Principles
- Controller = `while robot.step(timestep) != -1` loop; use the world `timestep`, not `sleep`.
- Get devices by name and enable them (`enable(timestep)`) before reading.
- Keep the control logic in pure functions so it can be tested without the simulator.
- Confirm the Webots version and check the official API docs (use `@researcher`).

## To complete by you
- Webots version, usual robots/worlds:
