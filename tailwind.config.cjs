/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      ground: "#F4F6F8",
      surface: "#FFFFFF",
      border: "#E3E7ED",
      ink: "#171A1F",
      "ink-2": "#3C444E",
      muted: "#8A929C",
      faint: "#A8B0BA",
      accent: "#A50034",
      "data-up": "#C6303A",
      "data-dn": "#2B62B8",
      "warn-fg": "#8F6B00",
      "warn-bg": "#FDF6E3",
      "verdict-local-bg": "#FBEAEF",
      "verdict-partial-border": "#F0C8D4",
      "verdict-group-fg": "#7A6570",
      "verdict-group-bg": "#F5F1F3",
      "verdict-wide-fg": "#4A525C",
      "verdict-wide-bg": "#EEF1F4"
    },
    borderRadius: {
      control: "6px",
      card: "8px"
    },
    extend: {
      fontFamily: {
        sans: ["Pretendard", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"]
      }
    }
  }
};
