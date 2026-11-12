/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./public/index.html"],
  theme: {
    extend: {
      colors: {
        "ty-bg": "#090D16",
        "ty-surface-low": "#0B101C",
        "ty-surface": "#111726",
        "ty-surface-high": "#182032",
        "ty-surface-highest": "#222B40",
        "ty-border": "rgba(255, 255, 255, 0.08)",
        "ty-border-strong": "#1E293B",
        "ty-emerald": "#00D26A",
        "ty-emerald-glow": "rgba(0, 210, 106, 0.25)",
        "ty-cyan": "#38BDF8",
        "ty-nequi": "#E10098",
        "ty-nequi-bg": "rgba(225, 0, 152, 0.12)",
        "ty-daviplata": "#ED1C24",
        "ty-daviplata-bg": "rgba(237, 28, 36, 0.12)",
        "ty-amber": "#F59E0B",
        "ty-rose": "#F43F5E",
        "ty-text": "#F8FAFC",
        "ty-muted": "#94A3B8"
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"]
      }
    }
  },
  plugins: [require("@tailwindcss/forms")]
};

