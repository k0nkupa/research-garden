# Defer cross-tab editor coordination

The challenge MVP will not implement a cross-tab writer-ownership protocol. Every mutation still rescans its target and compares content hashes, causing a proposal based on another tab's obsolete state to become stale instead of overwriting newer work. Coordinated multi-tab editing remains a post-challenge capability.
