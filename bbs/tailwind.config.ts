import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0F0F0F",
        surface: "#1A1A1A",
        "surface-raised": "#242424",
        border: "#2A2A2A",
        gold: {
          DEFAULT: "#D4B44A",
          hover: "#B8973A"
        },
        text: "#F5F0E8",
        muted: "#8A8580",
        success: {
          DEFAULT: "#2D6A4F",
          bright: "#52B788"
        },
        danger: {
          DEFAULT: "#C0392B",
          bright: "#E74C3C"
        },
        warning: {
          DEFAULT: "#B7860B",
          bright: "#F4C430"
        }
      },
      fontFamily: {
        sans: ["Geist", "Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      fontFeatureSettings: {
        tabular: '"tnum"'
      }
    }
  },
  plugins: []
};

export default config;
