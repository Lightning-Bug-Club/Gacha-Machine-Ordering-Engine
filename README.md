# Gata-Gata Gacha Machine — Color Customizer with Ordering

A Phase 1 2D orthographic color-customizer web app for the Lightning Bug Club Gata-Gata Gacha Machine with integrated cost estimation and ordering capabilities.

Built with vanilla JS / HTML / CSS. No build step — served directly via `python -m http.server`.

## Running the app

```bash
python -m http.server 8080
# Open http://localhost:8080
```

---

## New Features: Cost Estimation & Ordering

### Cost Estimation Panel
A new panel displays real-time cost estimates:
- **Filament Cost**: $25 per 1kg spool (rounded up per color to account for spool-only purchasing)
- **Machine Time**: $20 flat fee for 3D printing
- **Optional Add-on**: 50 clear plastic balls for $25 each
- **Live Updates**: Costs recalculate instantly as you change colors
- **Cost Breakdown**: Shows filament grams and kg needed per color

### Cost Transparency
The UI clearly explains:
- Filament is sold in 1kg spools only
- Costs are rounded up per color (if a color needs 1.2kg, you pay for 2kg)
- Customers can adjust colors to optimize cost

---

## Original Features

### Views: Front / Side / Back

The view selector offers three orthographic views of the machine.  
Switching views re-applies all current color selections immediately — all three views share the same logical color state keyed by part id.

The preview also supports **zooming and panning**:
- Mouse-wheel zoom centered on the cursor
- On-screen **+ / − / Reset** controls
- Click-and-drag panning while zoomed in
- Zoom/pan state stays active while switching between Front / Side / Back

### Parts list & color palette

Click a part in the sidebar, then click a swatch in the color palette to recolor it.  
The current color name and hex code are shown in the palette panel header.  
Colors are grouped by Bambu PLA series.

### Your Colors tray + smarter randomize

The palette panel includes a **Your Colors** tray with 4 slots.
- Click a slot to make it active, then click any palette swatch to assign that color to the slot.
- Use **Clear Slot** to remove the active slot color.
- Slot choices are saved in browser storage so they persist on refresh.

Randomize now works with the harmony selector and your slots together.

### Saved Builds (localStorage, max 5)

The palette panel also includes a **Saved Builds** section.
- Save the current configuration (name + all part color selections + windows material).
- Load a saved build at any time to restore viewer + share URL state.
- Delete saved builds you no longer need.

### Windows material selector

Directly above the parts list is a prominent **Windows** section with two options:

| Option | Behavior |
|--------|----------|
| **3D printed windows** (default) | The user can pick a PLA color for the windows. |
| **Clear acrylic windows** | Windows are fully transparent — no overlay is shown. The window color picker is disabled. |

### Shareable URL

The **Share** button copies a URL that encodes all current color selections **and** the windows material choice (`?c=...&w=printed|acrylic`). Pasting this URL restores the exact configuration.

### Export PDF

The **Export PDF** button generates a build blueprint PDF containing:
- Framed **Front / Side / Back** raster previews
- A legend table with part names, color swatches, hex codes, and filament usage
- A **Filament Needed by Color** summary table

### Visual style

The app uses a **Windows 95-inspired** interface with classic retro styling.

---

## File layout

```
/
├── index.html               # App shell
├── src/
│   ├── main.js              # UI wiring, view selector, palette, windows selector
│   ├── viewer2d.js          # SVG loader, layer normalizer, recolor engine
│   ├── state.js             # Shared state (selections, selectedPartId, windowsMaterial)
│   ├── palette.js           # Palette loader
│   ├── parts.js             # Parts loader
│   ├── pricing.js           # COST ESTIMATION ENGINE (NEW)
│   ├── pdf.js               # PDF export
│   ├── builds.js            # Saved builds (localStorage) helpers
│   └── styles.css           # App styles
├── assets/
│   ├── machine-front.svg    # Finalized front-view artwork
│   ├── machine-side.svg     # Finalized side-view artwork
│   └── machine-back.svg     # Finalized back-view artwork
├── data/
│   ├── parts.json           # Part definitions
│   ├── bambu-pla-colors.json # Bambu PLA color catalog
│   └── filament-usage.json  # Per-part filament usage estimates
└── scripts/
    └── fetch_bambu_pla.py   # Scraper for updating the color catalog
```

---

## Roadmap

- **Phase 2:** Replace `viewer2d.js` with a Three.js 3D viewer (`viewer3d.js`).
- **Phase 3A:** ✅ Cost estimation engine + display panel
- **Phase 3B:** Order submission button + build token generation
- **Phase 3C:** Backend API for order validation + cart redirect
- **Phase 3D:** Fulfillment pipeline (export configs, queue jobs)
