# Keep Garden Activity private and session scoped

The interface will show Garden Activity containing the action name, time, affected item IDs, and outcome without raw file bodies or tool results. Read activity remains session-scoped. Only the Pending Change and Undo Snapshot records already required for safe writes persist under `.research-garden/`.
