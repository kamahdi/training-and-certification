# Clinic Waiting Room UI/UX Specification

The screens a patient sees on their phone and the screens staff use on the clinic PC, for phase 1 (MVP). Built with the ETHIX Design System; static prototype in [ux/prototype/](ux/prototype/index.html), live design canvas at https://claude.ai/artifact/HttkeVGgFEciX8gnvBUQSQ.

## Users

- **Patients** on their own phone browser: no app, no account (ADR-004).
- **Medical professionals** on the clinic PC, in a browser next to the clinic's existing web app.
- **Reception** on the clinic PC.

## Screens

| Screen | Device | Prototype |
| --- | --- | --- |
| Visit page · waiting | Patient's phone | [ux/prototype/visit-page-waiting.html](ux/prototype/visit-page-waiting.html) |
| Visit page · called | Patient's phone | [ux/prototype/visit-page-called.html](ux/prototype/visit-page-called.html) |
| QR check-in · recognized phone | Patient's phone | [ux/prototype/check-in-recognized.html](ux/prototype/check-in-recognized.html) |
| QR check-in · text code | Patient's phone | [ux/prototype/check-in-text-code.html](ux/prototype/check-in-text-code.html) |
| Pre-visit form | Patient's phone | [ux/prototype/pre-visit-form.html](ux/prototype/pre-visit-form.html) |
| Professional queue | Clinic PC | [ux/prototype/professional-queue.html](ux/prototype/professional-queue.html) |
| Reception | Clinic PC | [ux/prototype/reception.html](ux/prototype/reception.html) |

## Key interaction rules

- The visit page shows an estimated call time as a **range** ("around 10:40–10:55"), never a rank or a countdown (WR-17). When it moves 10 minutes or more later, it says why in generic words (WR-18).
- The professional calls each patient aloud after pressing **"Next patient"**, which records the call; any other name can be called instead, and "Not here, skip" handles absent patients (WR-14 to WR-16).
- Check-in is one tap on a recognized phone, or a 4-digit text code; reception can always check a patient in (WR-07 to WR-09).
- Staff screens show **Live** or **Reconnecting…**; the visit page shows when it was last updated (ADR-002).

## Visual design

- **Design system:** ETHIX (tokens copied to `ux/prototype/ds/`). Colours, spacing and radii follow its tokens.
- **Type:** Inter for everything in the prototype. ETHIX specifies Satoshi for headings, but the design canvas could only load Google Fonts; use Satoshi in the build if it is licensed.
- **Primary buttons:** Deep Green (#006B44) instead of Emerald, because white on Emerald is 4.38:1, under the 4.5:1 minimum for button text.
- **Placeholders:** `[Clinic name]` and `[Fund name]` until real values exist. Patient and doctor names are invented sample data.

## Accessibility

- Real buttons, links, labels and inputs; touch targets at least 44 px.
- Text contrast at least 4.5:1; a warning colour always comes with a word.
- Patient pages must stay usable at 200% text size (qa/test-strategy.md › Test plan by area).

## Still to design

- Empty, error and "Reconnecting…" states for each screen.
- French and Dutch copy (WR-26); the prototype shows English with the language switch.
- Manager screens for erasure and export (WR-31, WR-32) and the daily summary (WR-25).
