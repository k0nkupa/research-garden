# Bound WebMCP read results

Garden search defaults to ten and caps at twenty-five results, while `read_items` accepts at most five identities and reports explicit truncation and continuation information for bounded bodies. Agents can retrieve more deliberately without one call silently consuming the entire Garden or its available context.
