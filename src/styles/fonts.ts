/**
 * The Botanical Instrument typefaces (ADR 0039).
 *
 * Self-hosted rather than fetched from a font CDN. A webfont request to a third
 * party would tell that party which pages a person opened and when, which is
 * exactly the passive disclosure ADR 0073 rules out -- and it would break the
 * offline shell ADR 0072 promises, since the application would render in
 * fallback faces the moment the network went away.
 *
 * Only the weights actually used are imported, and Literata is brought in on its
 * weight axis alone rather than the whole family. The remaining subsets --
 * Cyrillic, Greek, Vietnamese -- are each gated by `unicode-range`, so a browser
 * fetches only the ones the text on screen actually needs; they sit in the
 * build so that a Garden written in those scripts renders properly rather than
 * in a fallback face.
 *
 * When the service worker lands (ticket 16) its precache must include woff2, or
 * the offline shell ADR 0072 promises will render in fallback faces.
 */
import '@fontsource-variable/literata/wght.css'
import '@fontsource/instrument-sans/latin-400.css'
import '@fontsource/instrument-sans/latin-500.css'
import '@fontsource/instrument-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
