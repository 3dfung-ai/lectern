---
title: Lectern – your talks, from the first idea to the podium
tags: [lectern, talks, slides, pptx, pwa, offline-first, google-drive-sync, apps-script, rehearsal, presenter-view]
last_verified: 2026-11-22
---

# Lectern

**TL;DR:** Open <https://3dfung-ai.github.io/lectern/> in Brave and bookmark it. Drop a .pptx on it (or let Claude drop one in Drive › 00_Apps › Lectern › Inbox). Review the slides with your notes, edit notes and save them back into PowerPoint, flag slides for Claude, rehearse with a clock, print podium notes, and present with a speaker view. Works offline; syncs through your own Google Drive via your own Apps Script.

## How a talk gets made
| Step | Where | What happens |
|---|---|---|
| 0 Think | Claude › 1 Talk Ideas | Talk pack of PDFs, NotebookLM notebook, one-page spine. Claude keeps `Talks/<talk>/status.md` current, so the talk shows in Lectern from day one. |
| 1 Make | Claude › 2 Slide Workshop | Builds the deck from the spine; approved decks land in the Inbox and appear here. |
| 2 Rehearse | Lectern | Timed run with per-slide targets and a report; podium notes print; likely questions; read-aloud, MP3, cue cards, recording under More. |
| 3 Present | Lectern | Speaker view + projector window (B blanks it), or full screen on one display, or download the .pptx for a venue PC. |
| ↺ Improve | Lectern → Claude | E edits notes (saved as a new .pptx version); C flags a slide; both go to `Requests/<talk>.md` for Claude. |

## Drive layout (My Drive › 00_Apps › Lectern)
| Folder | Purpose |
|---|---|
| `Talks/<talk>/` | `status.md` (Claude), `spine.md`, `ideas.md` (J notes), `questions.md`, `Pack/` |
| `Inbox/` | Drop a .pptx (and optional same-named .pdf for exact pictures); Lectern imports it |
| `Decks/` | Current .pptx of each talk. Edit one in PowerPoint: Lectern makes it a new version |
| `Decks/_versions/` | Every version kept |
| `Requests/<talk>.md` | Claude's to-do list: your flags and notes edits |
| `Audio/` | Talk MP3s |
| `Pronunciations.txt` | How the voice says HbA1c, eGFR … |
| `_data/` | Index, slide pictures, backups. Leave alone |

## Files
| File | Purpose |
|---|---|
| `index.html`, `app.js` (built from `src/`) | The app |
| `sw.js`, `manifest.webmanifest`, icons | Offline start |
| `tts-worker.js`, `vendor/kokoro.web.js` | British voices in the browser (Kokoro, Apache-2.0); model downloads once from Hugging Face |
| `mp3-worker.js`, `vendor/lamejs.iife.js` | MP3 encoding |
| `vendor/pdf.min.mjs` | PDF to slide pictures (pdf.js) |
| `vendor/jszip.min.js` | Reading and writing .pptx |
| `lectern-sync.gs` | The Apps Script, for reference; Settings › Drive sync has a Copy button |
| `tests/` | Test double of the script and end-to-end checks |

No talks or personal data are stored in this repository.
