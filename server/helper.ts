import { solids } from "./server.ts";

//i don't want to export and import tsc shutup
export function getRandomPos(id :string, players: any ): [number, number] {
	let sx = 0;
	let sy = 0;

	do {
		sx = Math.floor(Math.random() * 800);
		sy = Math.floor(Math.random() * 800);
	} while (hitsSolid(sx, sy) || collidesWithAnyPlayer( {x: sx, y: sy}, id, players));
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
		if (distSq < 2704) return true;
	}
	return false;
}

export const hitsSolid = (px: number, py: number) =>
			solids.some(
				(box) =>
					px >= box.x &&
					px <= box.x + box.w &&
					py >= box.y &&
					py <= box.y + box.h,
			);

