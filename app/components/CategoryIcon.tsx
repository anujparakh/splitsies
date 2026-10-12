import type { ComponentType } from "react";
import type { CategoryId } from "../../shared/categories";
import {
  EntertainmentIcon,
  FoodIcon,
  GroceriesIcon,
  HealthIcon,
  HomeIcon,
  OtherIcon,
  TransportIcon,
  TravelIcon,
  type IconProps,
} from "./icons";

/**
 * Maps a category to its icon.
 *
 * A `Record<CategoryId, ...>` rather than a lookup with a fallback: adding a
 * category to `shared/categories.ts` without giving it an icon becomes a type
 * error here, which is exactly when you want to find out.
 */
const ICON_BY_CATEGORY: Record<CategoryId, ComponentType<IconProps>> = {
  food: FoodIcon,
  groceries: GroceriesIcon,
  entertainment: EntertainmentIcon,
  transport: TransportIcon,
  home: HomeIcon,
  travel: TravelIcon,
  health: HealthIcon,
  other: OtherIcon,
};

export function CategoryIcon({
  category,
  size = 20,
}: {
  category: CategoryId;
  size?: number;
}) {
  const Icon = ICON_BY_CATEGORY[category];
  return <Icon size={size} />;
}
