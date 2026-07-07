export interface DemoRouteItem {
  id: string;
}

export function buildDemoRoute<T extends DemoRouteItem>(
  items: readonly T[],
  previousId: string | null = null,
  random: () => number = Math.random
): T[] {
  const route = [...items];

  for (let index = route.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [route[index], route[swapIndex]] = [route[swapIndex], route[index]];
  }

  if (route.length > 1 && route[0]?.id === previousId) {
    [route[0], route[1]] = [route[1], route[0]];
  }

  return route;
}

export function formatMetricLabel(field: string): string {
  const spaced = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  if (!spaced) {
    return "Metric";
  }

  return spaced
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
