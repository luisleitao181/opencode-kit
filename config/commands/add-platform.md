---
description: Creates a new platform skill (e.g. Gazebo, MuJoCo, Godot). Usage - /add-platform <name>
agent: orchestrator
---
Create a new skill for the "$ARGUMENTS" platform in `~/.config/opencode/skills/<kebab-case-name>/SKILL.md`
(the folder is a symlink to the kit repo, so it is versioned).

1. Use `@researcher` to gather: how to install it, main Python API, common pitfalls, current version.
2. Write the SKILL.md with frontmatter (`name` equal to the folder name, specific `description`) and sections:
   When to use / Principles / To complete by you.
3. If an official and useful MCP server exists, give me the JSON block to add to `opencode.jsonc` (don't install without my confirmation).
4. Update the skills list in `AGENTS.md` and `agents/robotics.md` if needed.
