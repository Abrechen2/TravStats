/**
 * Types for the theme generator, so the test that guards it can import it
 * without an escape hatch. The generator itself stays a plain build script —
 * it runs under `node` with no compile step, which is the point of an `.mjs`.
 */
export declare const TOKENS_PATH: string;
export declare const OUTPUT_PATH: string;
export declare const TS_OUTPUT_PATH: string;
export declare function buildThemeCss(): string;
export declare function buildThemeTs(): string;
