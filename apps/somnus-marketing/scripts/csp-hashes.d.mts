export function decodeAttribute(raw: string): string;
export function sha256(value: string): string;
export function styleAttributeValues(html: string): string[];
export function inlineScripts(html: string): string[];
export function inlineStyles(html: string): string[];
export function completePolicy(html: string): string;
export function applyToDirectory(directory: string): Promise<number>;
