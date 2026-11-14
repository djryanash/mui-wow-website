## 1. Color Palette

* **Background & Ambiance:** Deep twilight gradient transitioning from a fiery sunset orange (`#FF5E36`) to tropical dusk violet/indigo (`#2C1B4D` / `#1A1130`).
* **Primary Accents:**
* **Neon Magenta/Pink:** Used for glowing text (`#FF2A8D`).
* **Warm Amber/Gold:** Used for sunset glows, fairy lights, and wood sign highlights (`#FFB300`).
* **Rich Wood Tones:** Textured rustic planks ranging from deep mahogany (`#3E1F0F`) to warm cedar (`#8B5A2B`).


* **Nature Tones:** Lush tropical greens (`#1E3F20`, `#2E5A36`) for palm fronds and Monstera leaves, accented with vibrant hibiscus red/pink (`#FF3366`).

## 2. Typography & Fonts

* **Main Title ("TIKI"):** Carved, heavy 3D wooden block lettering with a carved tribal texture. *Web alternatives:* **Bangers**, **Shrikhand**, or custom heavy display serif with wood-grain SVG text-fill.
* **Secondary Title ("SESSIONS"):** Bright, electric script/brush style with an outer neon glow effect. *Web alternatives:* **Pacifico**, **Caveat**, or **Cookie** with CSS `text-shadow` bloom (`0 0 10px #ff2a8d, 0 0 20px #ff2a8d`).
* **Subheadings & Details (Dates, Times, Location):** Thick, rugged, all-caps sans-serif or stamped stencil font. *Web alternatives:* **Impact**, **Oswald**, or **Anton** styled with a slight letter-spacing.
* **Taglines & Body Text:** Clean, casual rounded sans-serif or hand-lettered aesthetic. *Web alternatives:* **Montserrat** (Bold/Medium) or **Quicksand**.

## 3. Textures, UI & Structural Elements

* **Background Atmosphere:** Tropical beach silhouette at sunset, string rattan/bamboo pendant lights (`rgba` drop-shadows), bokeh light spots, and dense tropical foliage framing the edges.
* **Signage Containers:** Floating horizontal wooden planks with visible wood-grain patterns, rounded/distressed edges, and subtle inner shadows to look like carved signposts pinned on a beach stage.
* **Dividers & Icons:** Thin white vertical divider lines, minimal glyph icons (calendar, clock, map pin, cocktail glass, sofa, aloha shirt).

## 4. CSS Style Directives for Coding Agent

```css
:root {
  --bg-gradient: linear-gradient(135deg, #2c1b4d 0%, #ff5e36 100%);
  --neon-pink: #ff2a8d;
  --tiki-gold: #ffb300;
  --wood-dark: #3e1f0f;
  --wood-light: #8b5a2b;
}

body {
  background: var(--bg-gradient);
  font-family: 'Montserrat', sans-serif;
  color: #ffffff;
}

.neon-glow {
  color: var(--neon-pink);
  text-shadow: 0 0 8px rgba(255, 42, 141, 0.8), 0 0 20px rgba(255, 42, 141, 0.4);
}

.wooden-plank {
  background: linear-gradient(to bottom, #704214, #4a2c0f);
  border: 2px solid #2b1706;
  box-shadow: 0 10px 20px rgba(0,0,0,0.5), inset 0 2px 4px rgba(255,255,255,0.1);
  border-radius: 6px;
  transform: rotate(-1deg);
}

```