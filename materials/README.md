# Materials — Tratamente Turcia by Medicross

This folder holds all the brand and content materials for the website. Drop
files into the matching subfolder and they'll be easy to reference from
`index.html`.

## Folder structure

| Folder        | What goes here                                                        |
|---------------|-----------------------------------------------------------------------|
| `logos/`      | Brand logos (Medicross / Tratamente Turcia) — SVG, PNG, favicon files |
| `images/`     | Photos: hero, clinics, doctors, Istanbul, treatment sections          |
| `icons/`      | Standalone icon files (SVG) if you replace the inline icons           |
| `documents/`  | PDFs, brochures, price lists, partner hospital info, legal text       |

## Brand colors (from the site)

| Token         | Hex        | Use                         |
|---------------|------------|-----------------------------|
| Navy          | `#0A2A43`  | Headers, footer, dark bg    |
| Navy 2        | `#0F3A5C`  | Gradient / secondary dark   |
| Teal          | `#0E9DA9`  | Primary accent, buttons     |
| Teal dark     | `#0A7E88`  | Hover states                |
| Teal light    | `#E4F4F5`  | Soft backgrounds, icon bg   |
| Red           | `#E23B43`  | Call-to-action, highlights  |
| Red dark      | `#C42D35`  | CTA hover                   |
| Ink           | `#142633`  | Body text                   |

## Fonts

- **Playfair Display** — headings (serif)
- **Manrope** — body text (sans-serif)

## How to reference a file from index.html

```html
<!-- a logo -->
<img src="materials/logos/medicross-logo.svg" alt="Medicross" />

<!-- a hero photo as a CSS background -->
<div style="background-image: url('materials/images/hero-istanbul.jpg')"></div>
```

## Naming tips

- Use lowercase and hyphens: `hero-istanbul.jpg`, `dr-popescu.png`.
- Keep the original high-res file plus an optimized web version if needed
  (e.g. `hospital-acibadem.jpg` and `hospital-acibadem@2x.jpg`).
- Prefer SVG for logos and icons, WebP/JPG for photos.
