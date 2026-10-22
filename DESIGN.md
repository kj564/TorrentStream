# DESIGN — TorrentStream

A torrent streaming app. The UI must feel like a precision instrument panel, not a startup landing page. Data dominates, decoration recedes.

## Identity

The product is a tool, not a brand. The visual voice is borrowed from Swiss hi-fi equipment, audio mixers, and oscilloscope readouts: lots of structural whitespace, tabular numbers, hairline rules, a single warm accent that means "this is alive". A user should look at the screen and know what is happening without reading any labels.

## Palette (R-29: 2 core + 1 accent)

- **Background, dark**: warm near-black. Tailwind `stone-950` / `stone-900`. Not pure black, not zinc (zinc is cool and reads as "generic tech"; stone has a warm undertone that reads as material).
- **Background, light**: `stone-50` / `stone-100`. Same warm family.
- **Foreground**: `stone-100` on dark, `stone-900` on light.
- **Accent**: `amber-500`. One accent, used sparingly: active progress, online status, the one CTA on screen, the focus ring. Reasons: amber evokes precision backlight, is not blue/indigo (house rule), is not the "tech green" default.
- **Subdued**: `stone-500` for metadata, `stone-600` for inactive chrome.

Neutrals (stone family) do not count toward the core palette. Amber is the only chromatic color in the UI. File-type icons are monochrome letter marks (V / A / I / S), not colored Lucide icons.

## Typography (R-06)

- **Prose** (headings, body): Geist Sans. Reason: clean grotesk that lets data dominate. The body typeface is intentionally subordinate to the data it labels.
- **Data** (numbers, hashes, speeds, sizes, infoHash): Geist Mono with `font-variant-numeric: tabular-nums`. Reason: torrent data is read by scanning columns of figures; tabular alignment is functional, not decorative. Monospace also signals "this is machine output, treat it as data".
- No large monospace headings. No uppercase wide-tracked eyebrows. Labels are sentence case, small, `stone-500`.

## Dials (Liveliness Toolkit)

- **ENERGY 1** — calm. Linear/GOV.UK register. The page says "here is your data", not "look at me".
- **RHYTHM 2** — consistent with deliberate breaks. The torrent card itself varies by state: active is dense, paused is dimmed, complete is collapsed, error is prominent. This is the only intentional rhythm break.
- **MOTION 1** — hover only. No scroll-reveal, no floating, no bounce. One exception: the progress bar for the currently downloading torrent has a slow `animate-pulse` on its unfilled portion. Reason: it is the only piece of UI that means "this is changing right now", and pulse is the cheapest honest signal for that.

## Identity motif

- **Hairline rules**: 1px horizontal dividers in low-contrast stone tone between every section. Reads as a ruled ledger, not a card grid.
- **Tabular figures**: every number is `tabular-nums` monospace. Speeds, sizes, percentages, peer counts.
- **Status dot**: a small filled circle (6px) for state. Amber = active, stone = idle, red = error, emerald (only here, as data not chrome) = complete. The dot replaces badges.
- **Monospace metadata**: infoHash, port, file paths always in Geist Mono. Body never.

## Layout

- Header: thin, single row, wordmark left, status dot + theme toggle right.
- Input: one section, no card chrome around it. The input itself is the focal point. Sample torrents sit below as text buttons, not pill badges.
- Torrent list: cards have hairline borders only (no shadow). Compact density. Each card's internal layout varies by state.
- Empty state: a single sentence in the middle of the page. No illustration, no icon-in-circle, no suggestion to "try a sample" because the samples are already visible above.
- Footer: one line, hairline top border. States the backend honestly: "Backend: Go + anacrolix/torrent on port 3003".

## What this design does NOT do

- No gradient on the logo. The wordmark is text.
- No Lucide icons for file types. They are letter marks.
- No capsule badges with dots. Status is a single dot.
- No shadow on cards. Hairline borders only.
- No "AI Powered" / "Real-time" / "Seamless" copy.
- No fake statistics. Numbers come from the Go backend, and when they are zero, they show as zero.
- No theme forced. Light and dark both ship, both work.

## Conflict protocol

If the user asks for a pattern that collides with a Hard Gate rule (R-02 em dash, R-17 fake stats, R-24 dead links, R-25 contrast, R-26 dead controls, R-27 missing states, R-32 keyboard, R-34 broken theme, R-36 fabricated claims, R-38 fabricated content), name the rule, name the conflict, and ask before shipping. Identity choices (palette, typeface, motion level) are the owner's to make and are not slop.
