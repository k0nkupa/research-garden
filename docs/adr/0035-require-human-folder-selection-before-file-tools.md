# Require human folder selection before file tools

WebMCP always exposes only the non-filesystem `describe_research_garden` tool until both a Garden is open and the user explicitly enables Agent Access. Create Garden or Open Garden establishes browser folder permission but does not itself register filesystem-backed tools. Permission-dependent capabilities therefore never appear usable before the browser has a selected Garden Repository and the person has deliberately connected ChatGPT for that session.
