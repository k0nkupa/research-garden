# Store relationships in item-local frontmatter

Each canonical Markdown item stores its stable identity, botanical kind, title, primary parent, timestamps, and outgoing relationships in readable YAML frontmatter. Claim Leaves and Harvests serialize Root evidence as `supported_by`, the item-local inverse of the domain's Supports relationship, so new knowledge never requires mutating immutable Root evidence.
