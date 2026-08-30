/**
 * The bare trunk shown before a Garden exists (ADR 0046).
 *
 * This is illustration, not content: it is hidden from assistive technology so
 * the two actions at the soil line carry the whole meaning of the screen. The
 * botanical form is deliberately restrained here and is refined into the full
 * Botanical Instrument visual system in a later ticket (ADR 0039, ADR 0043).
 */
export function BareTrunk() {
  return (
    <svg
      className="bare-trunk"
      data-testid="bare-trunk"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 320 260"
      preserveAspectRatio="xMidYMax meet"
    >
      {/* Roots, below the soil line. */}
      <g className="bare-trunk__roots" data-role="root-flare">
        <path d="M160 196 C 140 214, 116 220, 92 232" />
        <path d="M160 196 C 180 214, 204 220, 228 232" />
        <path d="M160 196 C 154 216, 150 228, 148 244" />
        <path d="M160 196 C 168 214, 176 224, 186 240" />
      </g>

      <g className="bare-trunk__root-hairs" data-role="root-hair">
        <path d="M92 232 l-16 6 M92 232 l-9 12" />
        <path d="M228 232 l16 6 M228 232 l9 12" />
        <path d="M148 244 l-10 8 M148 244 l-3 11" />
        <path d="M186 240 l10 8 M186 240 l3 11" />
      </g>

      {/* The permanent base is intentionally branch-free; knowledge limbs are runtime data. */}
      <g className="bare-trunk__trunk" data-role="permanent-trunk">
        <path d="M160 196 C 153 174, 153 129, 162 96" data-layer="structural" />
        <path d="M161 192 C 158 170, 158 132, 163 101" data-layer="detail" />
      </g>

      <line className="bare-trunk__soil" x1="24" y1="196" x2="296" y2="196" />
    </svg>
  )
}
