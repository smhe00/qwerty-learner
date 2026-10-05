# Agent Reports

This directory stores execution reports and handoff checkpoints for tasks in
`interactive/tasks/`.

Naming convention:

```text
TASK-YYYYMMDD-NNN-short-name-report.md
```

Rules:

- one canonical report per active task;
- update the report during meaningful checkpoints;
- include exact commit SHA(s);
- distinguish PASS / FAIL / NOT_RUN for validation;
- preserve remaining risks and next actions;
- make the report sufficient for a replacement agent to continue.

Chat/Reviewer may append a final review decision to the same report or create a
follow-up task when rework is required.
