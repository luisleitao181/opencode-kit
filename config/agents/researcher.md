---
description: Researches library/API and web documentation (Context7, webfetch). Cheap; use it to look up docs instead of spending the main model.
mode: subagent
model: opencode-go/deepseek-v4.1-flash
request:
  body:
    temperature: 0.2
steps: 15
permissions:
  - action: edit
    resource: "*"
    effect: deny
  - action: shell
    resource: "*"
    effect: deny
  - action: webfetch
    resource: "*"
    effect: allow
  - action: websearch
    resource: "*"
    effect: allow
  - action: "context7_*"
    resource: "*"
    effect: allow
  - action: "exa_*"
    resource: "*"
    effect: allow
  # Leaf agent: no subagents of its own.
  - action: subagent
    resource: "*"
    effect: deny
---
You research documentation and answer with the minimum necessary.

- For libraries/frameworks use `context7` first; only then the web.
- Return: direct answer, minimal code snippet and link/source. No filler text.
- State the library version the answer refers to.
- If sources disagree or you can't find it, say so clearly.
