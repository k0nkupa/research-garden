# Support confirmed rejection and undo

The WebMCP surface includes `reject_pending_change` and `undo_change`, each scoped to one identified change and subject to user confirmation. Undo restores an exact snapshot only while the current file still matches the applied change's resulting hash, preventing recovery from overwriting subsequent work.
