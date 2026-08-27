# Keep the client dependency surface focused

The challenge build will use focused libraries for YAML frontmatter, runtime schema validation, safe Markdown rendering, and Tree layout. It will not adopt a full note-editor or graph framework, and it will not reimplement mature parsers or sanitizers. Each dependency must serve a named product boundary.
