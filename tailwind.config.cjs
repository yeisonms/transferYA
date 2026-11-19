/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./public/**/*.html"],
  theme: {
    extend: {
      colors: {
        // Nueva Paleta Oficial TransferYA (Humana & Comercial)
        "ty-green": "#19C37D",
        "ty-green-dark": "#0B7A4B",
        "ty-ink": "#0E1B2B",
        "ty-cream": "#F7F5EF",
        "ty-mango": "#FFB020",
        "ty-alert": "#D93F44",

        // Cockpit / Sistema
        "ty-bg": "#090D16",
        "ty-surface-low": "#0B101C",
        "ty-surface": "#111726",
        "ty-surface-high": "#182032",
        "ty-surface-highest": "#222B40",
        "ty-border": "rgba(255, 255, 255, 0.08)",
        "ty-border-strong": "#1E293B",
        "ty-emerald": "#19C37D",
        "ty-emerald-glow": "rgba(25, 195, 125, 0.25)",
        "ty-cyan": "#38BDF8",
        "ty-nequi": "#E10098",
        "ty-nequi-bg": "rgba(225, 0, 152, 0.12)",
        "ty-daviplata": "#ED1C24",
        "ty-daviplata-bg": "rgba(237, 28, 36, 0.12)",
        "ty-amber": "#FFB020",
        "ty-rose": "#D93F44",
        "ty-text": "#F8FAFC",
        "ty-muted": "#94A3B8"
      },
      fontFamily: {
        sans: ["Inter", "Plus Jakarta Sans", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"]
      }
    }
  },
  plugins: [require("@tailwindcss/forms")]
};

