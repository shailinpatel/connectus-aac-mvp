export type Category = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
};
export type Tile = {
  id: string;
  categoryId: string;
  text: string;
  symbol: string;
  photoId: string | null;
  isFavorite: boolean;
  sortOrder: number;
};
export type Board = {
  id: string;
  name: string;
  categories: Category[];
  tiles: Tile[];
};
export const palette = [
  "blue",
  "peach",
  "rose",
  "green",
  "yellow",
  "purple",
  "teal",
  "sand",
] as const;
export const symbols = [
  "more",
  "help",
  "stop",
  "go",
  "want",
  "like",
  "dislike",
  "all_done",
  "yes",
  "no",
  "person",
  "people",
  "map",
  "up",
  "down",
  "on",
  "off",
  "door",
  "eat",
  "drink",
  "play",
  "book",
  "hello",
  "goodbye",
  "happy",
  "sad",
  "tired",
  "scared",
  "love",
  "rest",
  "bathroom",
  "doctor",
  "tv",
  "outside",
  "music",
  "school",
  "write",
  "draw",
  "backpack",
  "lunch",
] as const;
export function tileImage(tile: Pick<Tile, "photoId" | "symbol">) {
  return tile.photoId
    ? `/api/photos/${tile.photoId}`
    : `/pictograms/${tile.symbol}.${["again", "look", "wash", "it"].includes(tile.symbol) ? "svg" : "png"}`;
}
