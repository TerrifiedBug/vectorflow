// src/lib/vrl/vrl-language.ts

import type { languages } from "monaco-editor";

export const vrlLanguageDef: languages.IMonarchLanguage = {
  keywords: [
    "if", "else", "abort", "null", "true", "false", "let", "not", "err",
  ],

  operators: [
    "=", "==", "!=", ">", "<", ">=", "<=", "&&", "||", "??", "!",
    "+", "-", "*", "/", "%", "|",
  ],

  tokenizer: {
    root: [
      // Comments (single-line only)
      [/#.*$/, "comment"],

      // Timestamp literals: t'...'
      [/t'[^']*'/, "string.timestamp"],

      // Raw string literals: s'...'
      [/s'[^']*'/, "string.raw"],

      // Regex literals: /pattern/flags
      [/\/(?:[^\/\\]|\\.)+\/[igm]*/, "regexp"],

      // Strings with interpolation support
      [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],

      // Field paths: .foo.bar_baz
      [/\.[a-zA-Z_][a-zA-Z0-9_.]*/, "field"],

      // Function calls: identifier followed by (
      [/[a-zA-Z_][a-zA-Z0-9_]*(?=\s*\()/, {
        cases: {
          "@keywords": "keyword",
          "@default": "function",
        },
      }],

      // Identifiers and keywords
      [/[a-zA-Z_][a-zA-Z0-9_]*/, {
        cases: {
          "@keywords": "keyword",
          "@default": "identifier",
        },
      }],

      // Numbers
      [/0[xX][0-9a-fA-F]+/, "number.hex"],
      [/0[oO][0-7]+/, "number.octal"],
      [/\d+\.\d+([eE][-+]?\d+)?/, "number.float"],
      [/\d+/, "number"],

      // Operators
      [/[=!<>]=?/, "operator"],
      [/[&|?]{1,2}/, "operator"],
      [/[+\-*\/%|]/, "operator"],

      // Brackets
      [/[{}()\[\]]/, "@brackets"],

      // Whitespace
      [/\s+/, "white"],
    ],

    string: [
      // String interpolation: {{ ... }}
      [/\{\{/, { token: "string.interpolation", next: "@interpolation" }],
      [/[^"\\{]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
    ],

    interpolation: [
      [/\}\}/, { token: "string.interpolation", next: "@pop" }],
      // Inside interpolation, we go back to root-like tokenization
      [/\.[a-zA-Z_][a-zA-Z0-9_.]*/, "field"],
      [/[a-zA-Z_][a-zA-Z0-9_]*/, "identifier"],
      [/\s+/, "white"],
      [/./, "string.interpolation"],
    ],
  },
};
