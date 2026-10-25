---
name: ros2-python
description: Conventions and checklist for writing ROS 2 nodes in Python (rclpy), packages, launch files and tests.
metadata:
  opencode/slash: "true"
---
## When to use
Tasks with ROS 2 in Python: nodes, publishers/subscribers, services, actions, launch, parameters.

## Conventions
- Nodes as classes inheriting from `rclpy.node.Node`; `main()` with `rclpy.init/spin/shutdown` in try/finally.
- Declare parameters with `declare_parameter` (with defaults) and configurable values via YAML; nothing hardcoded.
- Explicit QoS for sensors (`qos_profile_sensor_data`) and commands.
- Timers instead of `while`/`sleep`; short callbacks; heavy work in threads/executors.
- Explicit frames/TF; SI units; timestamps via `self.get_clock().now()`.
- `ament_python` package: `setup.py`/`package.xml` with dependencies, entry points in `console_scripts`.
- Tests with `pytest` (`launch_testing` for integration).

## Check before calling it done
- `colcon build --packages-select <pkg>` and `colcon test`.
- `ros2 topic list/echo`, `ros2 node info` to validate interfaces.

## To complete by you
ROS distribution used (e.g. Humble/Jazzy), default workspace, usual robots/packages:
- (fill here)
