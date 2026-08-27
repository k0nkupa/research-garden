# Verify every canonical write

Before replacing a canonical file, Research Garden will save its previous content as an Undo Snapshot. It will then perform one complete write, reread the resulting file, validate it, and confirm its content hash before reporting success. A browser write acknowledgement alone is insufficient completion evidence.
