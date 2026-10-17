/** @type {import('tailwindcss').Config} */

const colors = require("tailwindcss/colors");
const shades = [
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
];
const colorList = [
  "gray",
  "green",
  "cyan",
  "amber",
  "violet",
  "blue",
  "rose",
  "pink",
  "teal",
  "red",
  "qanawat",
];

// Qanawat Digital Communications brand maroon.
// 500/600/700 are the logo gradient stops: #C91852 -> #9E1240 -> #6E0D2C.
const qanawat = {
  50: "#fdf2f6",
  100: "#fce7ee",
  200: "#f9cfdd",
  300: "#f2a6bf",
  400: "#e56f92",
  500: "#c91852",
  600: "#9e1240",
  700: "#6e0d2c",
  800: "#5b0f27",
  900: "#4c1023",
  950: "#2a0812",
};
const uiElements = [
  "bg",
  "selection:bg",
  "border",
  "text",
  "hover:bg",
  "hover:border",
  "hover:text",
  "ring",
  "focus:ring",
];
const customColors = {
  cyan: colors.cyan,
  green: colors.green,
  amber: colors.amber,
  violet: colors.violet,
  blue: colors.blue,
  rose: colors.rose,
  pink: colors.pink,
  teal: colors.teal,
  red: colors.red,
  qanawat,
};

let customShadows = {};
let shadowNames = [];
let textShadows = {};
let textShadowNames = [];

for (const [name, color] of Object.entries(customColors)) {
  customShadows[`${name}`] = `0px 0px 10px ${color["500"]}`;
  customShadows[`lg-${name}`] = `0px 0px 20px ${color["600"]}`;
  textShadows[`${name}`] = `0px 0px 4px ${color["700"]}`;
  textShadowNames.push(`drop-shadow-${name}`);
  shadowNames.push(`shadow-${name}`);
  shadowNames.push(`shadow-lg-${name}`);
  shadowNames.push(`hover:shadow-${name}`);
}

const safelist = [
  "bg-black",
  "bg-white",
  "transparent",
  "object-cover",
  "object-contain",
  ...shadowNames,
  ...textShadowNames,
  ...shades.flatMap((shade) => [
    ...colorList.flatMap((color) => [
      ...uiElements.flatMap((element) => [`${element}-${color}-${shade}`]),
    ]),
  ]),
];

// Dark/light is chosen per screen at runtime (admin panel), so gray/black/
// white resolve to CSS variables set in globals.css: the dark values by
// default, and under html[data-theme="light"] the gray scale is flipped
// (950 <-> 50, ...) and black/white swapped. The UI is written dark-first
// (bg-gray-950 panels, text-gray-300 copy), so the same classes render a
// light theme with dark text. Spots that must stay a literal color (e.g. a
// QR code's white backing) use inline styles instead of these classes.
const cssVarColor = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const varGray = Object.fromEntries(shades.map((shade) => [shade, cssVarColor(`gray-${shade}`)]));

module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      black: cssVarColor("black"),
      white: cssVarColor("white"),
      gray: varGray,
      ...customColors,
    },
    extend: {
      dropShadow: {
        ...textShadows,
      },
      boxShadow: {
        ...customShadows,
      },
      keyframes: {
        "fade-in-out": {
          "0%": { opacity: "0" },
          "20%": { opacity: "1" },
          "80%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
      },
      animation: {
        "fade-in-out": "fade-in-out 1s ease-in-out",
      },
    },
  },
  plugins: [],
  safelist,
};
