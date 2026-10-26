#!/usr/bin/env node
/**
 * Install or remove the optional frontend design skills in ONE project.
 *
 * Nothing is installed globally. The script only touches the target project.
 *
 * Usage:
 *   node scripts/design-skills.mjs status [project]
 *   node scripts/design-skills.mjs install [project] [--skills=impeccable,emil-design-eng,...] [--dry-run]
 *   node scripts/design-skills.mjs uninstall [project] [--skills=...] [--purge] [--dry-run]
 *
 * Defaults to the current directory and to:
 *   impeccable, emil-design-eng, animate, review-animations, pick-ui-library
 */

import { existsSync, readFileSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_SKILLS = [
  "impeccable",
  "emil-design-eng",
  "animate",
  "review-animations",
  "pick-ui-library",
];
const EMIL_SKILLS = new Set(["emil-design-eng", "animate", "review-animations", "pick-ui-library"]);
const SKILL_ROOTS = [".opencode/skills", ".agents/skills", ".claude/skills"];
const IMPECCABLE_COMMAND = ".opencode/commands/impeccable.md";

function usage() {
  console.log(`Usage:
  node scripts/design-skills.mjs status [project]
  node scripts/design-skills.mjs install [project] [options]
  node scripts/design-skills.mjs uninstall [project] [options]

Options:
  --skills=id1,id2   Subset to act on. Default: ${DEFAULT_SKILLS.join(",")}
  --dry-run          Show actions without running or deleting anything
  --purge            With uninstall: also remove the project's .impeccable/ data
  --force            Allow running inside the kit repository itself

The script installs into the target project only. It never installs globally.`);
}

function parse(argv) {
  if (argv[0] === "--help" || argv[0] === "-h") {
    usage();
    process.exit(0);
  }
  const command = argv[0];
  const options = { dryRun: false, purge: false, force: false, skills: DEFAULT_SKILLS, project: "." };
  const positional = [];

  for (const arg of argv.slice(1)) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--purge") options.purge = true;
    else if (arg === "--force") options.force = true;
    else if (arg.startsWith("--skills=")) {
      options.skills = arg.slice("--skills=".length).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) throw new Error("Pass at most one project directory.");
  if (positional[0]) options.project = positional[0];
  if (!command || !["status", "install", "uninstall"].includes(command)) {
    usage();
    process.exit(command ? 1 : 0);
  }
  if (!options.skills.length) throw new Error("--skills cannot be empty.");
  for (const skill of options.skills) {
    if (skill !== "impeccable" && !EMIL_SKILLS.has(skill)) {
      throw new Error(`Unknown skill: ${skill}. Use impeccable or one of: ${[...EMIL_SKILLS].join(", ")}`);
    }
  }
  return { command, options };
}

function projectPath(input) {
  const project = resolve(input);
  if (!existsSync(project)) throw new Error(`Project directory does not exist: ${project}`);
  return project;
}

function isKit(project) {
  return (
    existsSync(join(project, "config", "opencode.jsonc")) &&
    existsSync(join(project, "scripts", "install.sh"))
  );
}

function skillPath(project, root, skill) {
  return join(project, root, skill);
}

function installed(project, skill) {
  return SKILL_ROOTS.some((root) => existsSync(skillPath(project, root, skill)));
}

function quoteWindowsArg(arg) {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

function run(command, args, cwd) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const isWindows = process.platform === "win32";
  const executable = isWindows ? process.env.ComSpec || "cmd.exe" : command;
  const argv = isWindows
    ? ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArg).join(" ")]
    : args;
  const result = spawnSync(executable, argv, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}`);
}

function printStatus(project, skills) {
  console.log(`Project: ${project}\n`);
  let found = 0;
  for (const skill of skills) {
    const ok = installed(project, skill);
    if (ok) found++;
    console.log(`${ok ? "  installed" : "  missing  "}  ${skill}`);
  }
  console.log(`\n${found}/${skills.length} selected skill(s) installed.`);
  console.log("Figma MCP authentication is separate: opencode mcp auth figma");
}

function install(project, options) {
  if (isKit(project) && !options.force) {
    throw new Error("Refusing to install design skills inside the kit repository. Run this in a frontend project.");
  }
  if (!existsSync(join(project, "package.json"))) {
    console.log("Warning: no package.json in this project; make sure it really is a frontend project.");
  }
  if (Number(process.versions.node.split(".")[0]) < 20) {
    throw new Error("Node.js 20 or newer is required.");
  }

  if (options.skills.includes("impeccable")) {
    if (options.dryRun) console.log("would install impeccable from pbakaus/impeccable");
    else {
      run("npx", ["-y", "impeccable", "install", "--providers=opencode", "--scope=project", "--no-hooks"], project);
    }
  }

  for (const skill of options.skills.filter((s) => s !== "impeccable")) {
    if (options.dryRun) {
      console.log(`would install ${skill} from emilkowalski/skills`);
      continue;
    }
    run(
      "npx",
      ["-y", "skills@latest", "add", "emilkowalski/skills", "--agent", "opencode", "--skill", skill, "--yes"],
      project,
    );
  }

  console.log("\nInstalled in this project only.");
  printStatus(project, options.skills);
}

function updateSkillsLock(project, removed, dryRun) {
  if (removed.length === 0) return;
  const path = join(project, "skills-lock.json");
  if (!existsSync(path)) return;
  try {
    const lock = JSON.parse(readFileSync(path, "utf8"));
    if (!lock || typeof lock.skills !== "object" || lock.skills === null) return;
    for (const skill of removed) delete lock.skills[skill];
    if (Object.keys(lock.skills).length === 0) {
      if (dryRun) console.log(`would remove ${path}`);
      else {
        rmSync(path, { force: true });
        console.log(`removed ${path}`);
      }
    } else {
      if (dryRun) console.log(`would update ${path}`);
      else {
        writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
        console.log(`updated ${path}`);
      }
    }
  } catch (error) {
    console.log(`Warning: could not update ${path}: ${error instanceof Error ? error.message : error}`);
  }
}

function pruneEmpty(path) {
  try {
    rmdirSync(path);
  } catch {
    // Not empty or already gone: leave it alone.
  }
}

function remove(project, options) {
  if (isKit(project) && !options.force) {
    throw new Error("Refusing to modify the kit repository. Run this in the project that owns the skills.");
  }

  for (const skill of options.skills) {
    for (const root of SKILL_ROOTS) {
      const path = skillPath(project, root, skill);
      if (!existsSync(path)) continue;
      if (options.dryRun) console.log(`would remove ${path}`);
      else {
        rmSync(path, { recursive: true, force: true });
        console.log(`removed ${path}`);
      }
    }
  }

  if (options.skills.includes("impeccable")) {
    const command = join(project, IMPECCABLE_COMMAND);
    if (existsSync(command)) {
      if (options.dryRun) console.log(`would remove ${command}`);
      else {
        rmSync(command, { force: true });
        console.log(`removed ${command}`);
      }
    }
  }

  if (options.purge) {
    const data = join(project, ".impeccable");
    if (existsSync(data)) {
      if (options.dryRun) console.log(`would remove ${data}`);
      else {
        rmSync(data, { recursive: true, force: true });
        console.log(`removed ${data}`);
      }
    }
  }

  updateSkillsLock(
    project,
    options.skills.filter((skill) => EMIL_SKILLS.has(skill)),
    options.dryRun,
  );

  if (!options.dryRun) {
    pruneEmpty(join(project, ".opencode", "commands"));
    for (const root of SKILL_ROOTS) {
      pruneEmpty(join(project, root));
      pruneEmpty(join(project, root.split("/")[0]));
    }
  }

  console.log("\nDone. Remaining state:");
  printStatus(project, options.skills);
}

try {
  const { command, options } = parse(process.argv.slice(2));
  const project = projectPath(options.project);
  if (command === "status") printStatus(project, options.skills);
  else if (command === "install") install(project, options);
  else remove(project, options);
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
