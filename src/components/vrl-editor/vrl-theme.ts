export const vrlTheme = {
  base: "vs-dark" as const,
  inherit: true,
  rules: [
    { token: "comment", foreground: "6A9955" },
    { token: "string", foreground: "CE9178" },
    { token: "keyword", foreground: "569CD6" },
    { token: "number", foreground: "B5CEA8" },
    { token: "operator", foreground: "D4D4D4" },
  ],
  colors: {
    "editor.background": "#1E1E1E",
  },
};
