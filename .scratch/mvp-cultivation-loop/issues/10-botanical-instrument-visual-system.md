# 10: Botanical Instrument visual system

**What to build:** The Garden looks like the confirmed concept rather than a generic diagram. The palette, typography, and botanical form are applied throughout, with the botanical illustration deliberately subordinated to the work: a person should be able to scan labels, selection, navigation, and evidence relationships immediately.

**Blocked by:** 09

**Status:** resolved

- [x] The Botanical Instrument palette is applied throughout: cool mineral canvas, deep bark ink, canopy green, lichen, pollen, and mulberry uncertainty
- [x] Literata carries reading and titles, Instrument Sans carries controls, and IBM Plex Mono carries metadata and activity
- [x] The Tree retains a recognizable trunk, roots, limbs, and restrained foliage
- [x] Decorative foliage is reduced until knowledge nodes dominate and labels stay immediately scannable
- [x] Colour contrast remains accessible, and every kind still carries shape, icon, and text label alongside colour
- [ ] The workspace matches the confirmed visual reference in the design record

## Notes

### What was built

The six palette tokens are declared once and used everywhere, with each kind
drawing its stroke and fill from them. The three typefaces are self-hosted
through `@fontsource`, so the visual system costs nothing in requests to a font
CDN; the layering test that forbids remote origins covers this, and a real
browser confirmed no request left the machine.

The Tree gained its strata. Canopy items rise above a soil line, the trunk
carries limbs out to them, and Roots hang below with Seeds sitting shallower
than Roots, since ADR 0028 says strata rather than two layers.

Every kind now carries four independent signals: shape, fill, a text label, and
an icon marked inside the form. The icon was the piece ADR 0044 asked for that
was genuinely missing rather than merely unpolished.

### Verified

Typecheck, 1022 tests, and a production build all pass.

The visual claims were checked in headless Chrome against a fixture holding one
item of all eight kinds, driven through the application's own Open Garden
button rather than by mounting components directly. That render confirmed all
eight glyphs and all eight distinct icons paint, all eight kind labels appear,
the trunk and soil are drawn, no console errors or exceptions occur, and no
network request leaves the machine. The Tree overflows its pane on a
1400-wide window, and the pane was confirmed to scroll far enough to reach the
overflowing nodes rather than clipping them away.

### Bugs the review and the browser caught

The icons shipped invisible. SVG fills a path by default and strokes none of
it, and every icon here is an open path, so they enclosed no area and painted
nothing. Every unit test passed throughout, because the geometry was correct
and only the paint was missing. Only looking at a real render found it. There
are now two guards asserting the mark is stroked rather than filled, and that
it switches to the canvas colour on a filled glyph, where bark on bark would be
equally invisible.

A Dormant Branch's label measured 3.88:1, under the 4.5:1 ADR 0044 asks for,
because dormancy faded the whole node. It now fades the glyph and leaves the
words alone.

Node titles were set in the control face; ADR 0039 gives titles to the reading
face.

The contrast test was overstated. It cannot measure contrast, which needs
rendered pixels, so it is now named and scoped as what it is: a ratchet against
re-lowering muted ink, plus a rule that no state an item rests in may fade text
below the floor. Dimming during evidence tracing is exempt by name rather than
by inference, because it lasts seconds and recovers on focus and on hover, and
a third test asserts that recovery. All of these were mutation-tested: each was
confirmed to fail when the defect it describes is reintroduced.

Smaller review findings, all fixed: a duplicated position lookup in the layout,
a `TRUNK_ID` sentinel replaced by an optional source on a link, and a font
import comment that claimed subsetting the build does not perform. The comment
now says accurately that the remaining subsets are gated by `unicode-range`.

### The unticked criterion

The workspace does not yet match the confirmed visual reference, and this is
left unticked rather than argued away. What still differs: there is no legend
strip explaining the kinds, no item-id badges on nodes, no canvas toolbar and
no header chrome beyond the repository name and the search box. Node labels are
truncated to a single line where the reference shows them wrapping in full. The
botanical form is more diagram than illustration; the reference has noticeably
richer limb and foliage drawing.

None of these are blocked by anything here. They are chrome and refinement on
top of a visual system that is otherwise in place, and they are better done
once the workspace stops gaining panels.
