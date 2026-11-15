// What the controller and the pack reader say, in the reader's language (PLAN.md M62). They are UI-free and
// keep their English text (their tests assert it); the screens pass a message through `phoneText` to show it.
// A text that is not recognised (a browser's own error, say) is shown as it came.

import { msg, tr } from '@frontend/i18n'

/** Messages with nothing variable in them. */
export const FIXED = [
  msg('Starting the data engine…'),
  msg('Preparing the comparison…'),
  msg('This build has no demo data.'),
  msg('The data pack stored on this phone was made by an older version of the app and can no longer be read. Import it again (make mobile-pack).'),
  msg('This file is not a data pack (it is not a zip file).'),
  msg('This file is not a data pack (manifest.json is missing).'),
  msg('This file is not a data pack.'),
  msg('This data pack does not say which car model it holds. Export it again with make mobile-pack.'),
  msg('Cannot open the storage of this browser'),
  msg('Storage failed'),
]

type Pattern = [RegExp, (m: RegExpExecArray) => string]

const PATTERNS: Pattern[] = [
  [/^Loading (.+)…$/, (m) => tr('Loading {name}…', { name: m[1] })],
  [/^Preparing the comparison: loading (.+)…$/, (m) => tr('Preparing the comparison: loading {name}…', { name: m[1] })],
  [
    /^This data pack has format (.+); this app reads format (.+)\. Update the app or export the pack again\.$/,
    (m) => tr('This data pack has format {has}; this app reads format {reads}. Update the app or export the pack again.', { has: m[1], reads: m[2] }),
  ],
  [
    /^This data pack was made by an older version and lacks signal families the app needs \((.+)\)\. Export it again with make mobile-pack\.$/,
    (m) => tr('This data pack was made by an older version and lacks signal families the app needs ({list}). Export it again with make mobile-pack.', { list: m[1] }),
  ],
  [
    /^This data pack was made by an older version and lacks signals the app needs \((.+)\)\. Export it again\.$/,
    (m) => tr('This data pack was made by an older version and lacks signals the app needs ({list}). Export it again.', { list: m[1] }),
  ],
  [
    /^This data pack was made by an older version and lacks (.+)\. Export it again with make mobile-pack\.$/,
    (m) => tr('This data pack was made by an older version and lacks {list}. Export it again with make mobile-pack.', { list: m[1] }),
  ],
  [/^The data pack is damaged: table (.+) is missing\.$/, (m) => tr('The data pack is damaged: table {name} is missing.', { name: m[1] })],
  [
    /^The data pack is damaged: table (.+) does not match its checksum\.$/,
    (m) => tr('The data pack is damaged: table {name} does not match its checksum.', { name: m[1] }),
  ],
]

export function phoneText(text: string): string {
  if (FIXED.includes(text)) return tr(text)
  for (const [pattern, say] of PATTERNS) {
    const m = pattern.exec(text)
    if (m) return say(m)
  }
  return text
}
