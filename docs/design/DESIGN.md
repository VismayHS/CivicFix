# Design system

**World:** a municipal service desk, civic signage rather than a SaaS template. The public pages persuade; the portals are working tools where precision beats decoration.

## Tokens (`web/src/app/globals.css`)

| Token | Value | Use |
|---|---|---|
| `--paper` / `--background` | `#f6f4ef` | Page ground (warm paper, not white) |
| `--foreground` | `#17202c` | Body text (ink, never pure black) |
| `--primary` | `#17324d` | Municipal navy: primary buttons, selection, SLA bar in time |
| `--rail` | `#14283c` | Portal sidebar and the dark band on the landing page |
| `--signal` / soft | `#9a5a00` / `#fbefd9` | SLA risk only (warning, reopened) |
| `--danger` / soft | `#a8231c` / `#fbe5e2` | Breached deadline, escalations |
| `--ok` / soft | `#24693f` / `#e3f0e6` | Resolved, within SLA |
| `--info` / soft | `#24578a` / `#e2ecf6` | Assigned, in progress |
| `--dup` / soft | `#5f4596` / `#ece6f6` | Duplicates and merges |
| `--radius` | `0.5rem` | Crisp corners; pills only for status badges |

State colours appear only where they carry meaning.

## Type

- **Public Sans** for UI and body: an open-source typeface made for government services, and it avoids the Inter look.
- **Newsreader** (serif) for page titles and landing headlines: a gazette or notice-board voice.
- **IBM Plex Mono** for data only: complaint references (`CF-00042`), timestamps, counts, SLA times. Always tabular figures.

## Signature element: the SLA clock

`components/complaint/sla-bar.tsx`. Every complaint shows a bar from "filed" to 125% of its SLA window, with a notch at the deadline (80% of the track) so overruns stay visible. Navy while in time, amber under 25% left, red when breached, green when resolved in time. The staff queue sorts by it.

## Motion

- One authored moment: the landing headline (React Bits **BlurText**) and figures (React Bits **CountUp**). Both respect `prefers-reduced-motion`.
- In the portals, motion is functional only: button press `scale(0.97)` over 150 ms ease-out, toasts (Sonner), dialog transitions. No decorative motion in work queues.
- Easing: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`. Never ease-in for UI.

## Rules we follow (from impeccable, taste-skill minimalist-ui and Emil Kowalski's skills)

- No eyebrow labels above headings, no gradient text, no nested cards, no glassmorphism.
- Figures are ruled rows (`StatStrip`), not a grid of identical KPI cards.
- Tables on desktop, stacked cards on phones (`ComplaintTable`).
- Every list has an empty state, every form a visible error per field, every action a pending state.
- Browser surfaces are themed: selection colour, focus ring, scrollbar, underline offset.

## Toolkit for future UI work

| Tool | Install | When |
|---|---|---|
| impeccable | `npx impeccable install`, then `/impeccable init` | `audit`, `critique`, `polish`, `harden` before the demo |
| taste-skill | `npx skills add https://github.com/VismayHS/taste-skill-cc --skill "minimalist-ui"` | House style for portal screens |
| Emil's skills | `npx skills add https://github.com/VismayHS/skills-frontend-cc` | `break-ui`, `review-animations`, `mobile-native` |
| React Bits | `npx shadcn@latest add @react-bits/<Name>-TS-TW` (registry is already in `web/components.json`) | Public pages only |
| ponytail | `/plugin marketplace add DietrichGebert/ponytail` then `/plugin install ponytail@ponytail` | `/ponytail-review` before merges |
| ECC | `/plugin marketplace add https://github.com/affaan-m/ECC` then `/plugin install ecc@ecc` (one install path only) | Security review, secret scan before pushing |
| ruflo | Optional; review its code first | Not needed for this project |
