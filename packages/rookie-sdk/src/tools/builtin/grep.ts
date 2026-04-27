// Grep tool is implemented alongside glob.ts because they share the
// directory walker. This file re-exports so that both roadmap entries
// (glob.ts, grep.ts) have a predictable import path.

export { grepFilesTool } from "./glob.js";
