// Games the buylist trades in. Slugs must match the wholesale API's
// /api/v1/games slugs — they are passed verbatim as the ?game= param.
export const TRADEIN_GAMES = [
  { slug: "one-piece", label: "One Piece" },
  { slug: "pokemon", label: "Pokémon" },
  { slug: "dragon-ball", label: "Dragon Ball" },
] as const;

export type TradeinGameSlug = (typeof TRADEIN_GAMES)[number]["slug"];

export function isTradeinGame(game: string): game is TradeinGameSlug {
  return TRADEIN_GAMES.some((g) => g.slug === game);
}

export function gameLabel(slug: string): string {
  return TRADEIN_GAMES.find((g) => g.slug === slug)?.label ?? slug;
}
