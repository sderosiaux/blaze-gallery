import {
  Angry,
  CalendarDays,
  EyeOff,
  Frown,
  Ghost,
  Laugh,
  Mountain,
  Palette,
  PawPrint,
  Smile,
  Sparkles,
  Type,
  UserX,
  type LucideIcon,
} from "lucide-react";
import type { Expression } from "@/lib/photoFilter";
import type { FilterChip } from "./filterChips";

export const EXPRESSION_ICONS: Record<Expression, LucideIcon> = {
  sourit: Smile,
  rit: Laugh,
  triste: Frown,
  colere: Angry,
  surpris: Sparkles,
  peur: Ghost,
  yeux_fermes: EyeOff,
};

/** The icon a chip shows when it has no face or swatch. */
export function chipIcon(chip: FilterChip): LucideIcon | null {
  switch (chip.kind) {
    case "look":
      return chip.expression ? EXPRESSION_ICONS[chip.expression] : Smile;
    case "tag":
      return Mountain;
    case "only":
      return UserX;
    case "tone":
      return Palette;
    case "date":
      return CalendarDays;
    case "words":
      return Type;
    default:
      return null;
  }
}

export const ANIMAL_ICON = PawPrint;
