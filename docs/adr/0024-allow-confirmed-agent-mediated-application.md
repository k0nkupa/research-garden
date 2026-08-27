# Allow confirmed agent-mediated application

WebMCP may expose `apply_pending_change` so an agent can request application of one exact Pending Change through the browser agent's user-confirmation flow. The Garden still revalidates the preview and target state before writing; tool availability and host confirmation never replace application-enforced authorization or integrity checks.
