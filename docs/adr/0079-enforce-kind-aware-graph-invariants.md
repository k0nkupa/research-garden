# Enforce kind-aware graph invariants

The Garden Index rejects self-links, duplicate relationships, invalid source and target kind pairings, and cycles in Parent placement. `Contradicts` and `Relates To` are symmetric Cross-links; Parent, Derived From, Supports, and Answers remain directional. Non-parent Cross-links may form cycles because they do not determine Tree placement.
