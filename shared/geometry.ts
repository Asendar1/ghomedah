import type { Rect } from "./protocols.ts";

export function inflate(r: Rect, by: number): Rect {
	return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

export function contains(b: Rect, x: number, y: number): boolean {
	return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}
