import { PLAYER_R, solids } from "./config.ts";
import { contains } from "@ghomedah/shared/geometry";

//i don't want to export and import tsc shutup
export function getRandomPos(id: string, players: Map<string, { x: number; y: number }>): [number, number] {
	let sx = 0;
	let sy = 0;

	do {
		sx = Math.floor(Math.random() * 800);
		sy = Math.floor(Math.random() * 800);
	} while (solids.some((b) => contains(b, sx, sy)) || collidesWithAnyPlayer( {x: sx, y: sy}, id, players));
	return [sx, sy];
}

export function collidesWithAnyPlayer(
	pos: { x: number; y: number },
	selfId: string,
	players: Map<string, { x: number; y: number }>,
): boolean {
	for (const [id, other] of players.entries()) {
		if (id === selfId) continue;
		const distSq = (pos.x - other.x) ** 2 + (pos.y - other.y) ** 2;
		if (distSq < (PLAYER_R * 2) ** 2) return true; // (player 1 + player 2) ** 2. Thats where the magic number is from. all players have same radius so we can just use 2 * radius and square it. 2 * 26 = 52, 52 ** 2 = 2704
	}
	return false;
}

