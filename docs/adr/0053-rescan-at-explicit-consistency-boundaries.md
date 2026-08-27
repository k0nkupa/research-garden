# Rescan at explicit consistency boundaries

The challenge build will rescan the Garden Repository when the window regains focus, when the user requests Refresh, and immediately before an action whose correctness depends on current files. It will not continuously poll the entire folder. Hash and Garden Revision checks still protect every proposed or applied mutation from external edits.
