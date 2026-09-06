import {
  GraduationCap,
  HandHelping,
  LayoutGrid,
  MessageCircle,
  MessagesSquare,
  Puzzle,
  Smile,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

// Seed category IDs stay stable when tiles are edited or new categories are added.
const categoryIcons: Record<string, LucideIcon> = {
  "1": MessagesSquare,
  "2": MessageCircle,
  "3": Smile,
  "4": HandHelping,
  "5": UtensilsCrossed,
  "6": Users,
  "7": Puzzle,
  "8": GraduationCap,
};

export function CategoryIcon({ categoryId }: { categoryId: string }) {
  const Icon = categoryIcons[categoryId] || LayoutGrid;
  return <Icon size={20} strokeWidth={1.9} aria-hidden="true" />;
}
