import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

// Use locally bundled monaco-editor instead of fetching from cdn.jsdelivr.net.
// This avoids Content-Security-Policy violations for script-src.
loader.config({ monaco });
