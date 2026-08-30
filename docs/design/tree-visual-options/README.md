# Research Garden tree visual directions

These are approval prototypes, not integrated production assets. Each board is a standalone 1440×1024 inline SVG that can be opened directly in a browser or design tool.

| Option | Visual direction | Signature | Trade-off |
| --- | --- | --- | --- |
| A · Botanical engraving | Fine botanical ink with restrained bark grain and root hairs | Hand-drawn permanent trunk; clean limb attachment | Most organic and closest to the existing quiet botanical language |
| B · Vascular instrument | Precise bark outer stroke with lichen inner sap line | Pollen sap trace follows selected evidence | Strongest relationship/status signalling; slightly more technical |
| C · Pressed herbarium | Flat paper silhouettes with a subtle inline grain and sparse accents | Knowledge nodes feel like mounted specimens | Clearest labels and strongest print character; least dimensional |

All three boards demonstrate the same model: empty is a plain trunk, root flare, and soil with no limbs; young adds a few separate Parent paths and nodes; mature adds deeper Parent paths, evidence Roots below soil, all eight current kinds, and a dashed mulberry `Contradicts` cross-link. The glyph geometry and marks mirror `src/workspace/kindGlyphs.ts`.

The trunk/root base is reusable SVG (`<use>` of a `<g>` in each board), while every knowledge limb is a separate path to make the runtime attachment seam explicit. No raster images, external fonts, JavaScript, external assets, gradients, neon, glassmorphism, or production-code changes are included.
