import { MAP } from "./config.ts";

export function getRandomPos(): number {
	return Math.floor(Math.random() * 800);
}

export function collidesWithAnyPlayer(
	pos: { x: number; y: number },
	selfId: string,
	players: Map<string, { x: number; y: number }>,
): boolean {
	for (const [id, other] of players.entries()) {
		if (id === selfId) continue;
		const distSq = (pos.x - other.x) ** 2 + (pos.y - other.y) ** 2;
		if (distSq < 2704) return true;
	}
	return false;
}
