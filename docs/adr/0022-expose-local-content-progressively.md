# Expose local content progressively

After Agent Access is enabled, Garden inspection and search expose metadata and short snippets, while full Markdown bodies reach the browser agent only through an explicit `read_items` action that is visibly recorded in the interface. Research Garden therefore avoids silently placing the entire local Garden into cloud-agent context while keeping source-backed reasoning possible.
