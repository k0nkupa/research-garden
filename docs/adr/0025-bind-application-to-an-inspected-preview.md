# Bind application to an inspected preview

`apply_pending_change` is registered only after `inspect_pending_change` opens one exact diff, and the application request carries that change identity and preview hash. Before writing, Research Garden revalidates the folder permission, target content hash, and one-file scope; any mismatch marks the proposal stale instead of overwriting newer content.
