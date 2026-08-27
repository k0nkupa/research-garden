# Isolate invalid Garden files

An invalid canonical file will produce a Garden Diagnostic while the rest of the Garden remains available. The invalid item stays visible to `audit_garden`, and mutations targeting it are blocked until its known fields and relationships validate. Research Garden will neither hide invalid files nor make one malformed file prevent unrelated research from opening.
