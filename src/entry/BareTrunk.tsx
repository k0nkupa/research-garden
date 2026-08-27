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
      <g className="bare-trunk__roots">
        <path d="M160 196 C 140 214, 116 220, 92 232" />
        <path d="M160 196 C 180 214, 204 220, 228 232" />
        <path d="M160 196 C 154 216, 150 228, 148 244" />
        <path d="M160 196 C 168 214, 176 224, 186 240" />
      </g>

      {/* Trunk and bare limbs, above the soil line. */}
      <g className="bare-trunk__trunk">
        <path d="M160 196 L 160 96" />
        <path d="M160 138 C 142 122, 128 108, 116 86" />
        <path d="M160 124 C 178 110, 192 98, 202 78" />
        <path d="M160 104 C 152 88, 148 76, 146 58" />
        <path d="M160 100 C 170 86, 178 76, 184 60" />
      </g>

      <line className="bare-trunk__soil" x1="24" y1="196" x2="296" y2="196" />
    </svg>
  )
}
