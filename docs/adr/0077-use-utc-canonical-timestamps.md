# Use UTC canonical timestamps

Canonical `created_at` and `updated_at` values use ISO 8601 UTC serialization. `created_at` remains stable for an item's lifetime, while `updated_at` changes only when that canonical item is edited. Filesystem timestamps and the viewer's local timezone are presentation or cache inputs, not canonical history.
