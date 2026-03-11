// src/components/vrl-editor/vrl-theme.ts

export const vrlTheme = {
  base: "vs-dark" as const,
  inherit: true,
  rules: [
    { token: "comment", foreground: "6A9955" },
    { token: "string", foreground: "CE9178" },
    { token: "string.quote", foreground: "CE9178" },
    { token: "string.escape", foreground: "D7BA7D" },
    { token: "string.raw", foreground: "CE9178" },
    { token: "string.timestamp", foreground: "B5CEA8" },
    { token: "string.interpolation", foreground: "569CD6" },
    { token: "keyword", foreground: "569CD6" },
    { token: "number", foreground: "B5CEA8" },
    { token: "number.hex", foreground: "B5CEA8" },
    { token: "number.octal", foreground: "B5CEA8" },
    { token: "number.float", foreground: "B5CEA8" },
    { token: "operator", foreground: "D4D4D4" },
    { token: "function", foreground: "DCDCAA" },
    { token: "field", foreground: "9CDCFE" },
    { token: "regexp", foreground: "D16969" },
    { token: "identifier", foreground: "D4D4D4" },
  ],
  colors: {
    "editor.background": "#1E1E1E",
  },
};
