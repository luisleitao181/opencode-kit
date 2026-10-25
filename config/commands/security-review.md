---
description: Security-focused review of the current changes with the reviewer subagent. Usage - /security-review
agent: orchestrator
subagent: true
---
Use the `@reviewer` subagent to perform a security-focused review of the current `git diff` (and `git diff --staged`).

Reviewer focus (strict, `blocker` / `major` / `minor` only):
- secrets hardcoded or committed (keys, tokens, passwords, `.env` files, `credentials.json`, `service-account*.json`);
- password / credential storage (require argon2id / bcrypt / scrypt, never plaintext / md5 / sha1);
- SQL / command / LDAP injection (parameterized queries only, no string concatenation or interpolation);
- input validation, authentication and authorization;
- secrets leaked in logs, error messages or exception traces;
- insecure deserialization, `eval` / `exec`, or other dynamic code execution;
- unsafe temp files and permissions (world-writable files, predictable paths, missing `umask`);
- dependency risk (unpinned, unused, known-vulnerable, or over-privileged packages);
- `.env` handling (never committed except `.env.example`, loaded safely, not logged).

Return only findings that can change the merge decision, grouped by severity. No style nits, no "consider doing X someday" advice.
