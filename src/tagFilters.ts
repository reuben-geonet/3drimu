export interface SiteWithTags {
  tags: readonly string[];
}

export interface SiteTagOption {
  tag: string;
  count: number;
  label: string;
}

export function buildSiteTagOptions(
  sites: readonly SiteWithTags[]
): SiteTagOption[] {
  const counts = new Map<string, number>();

  for (const site of sites) {
    const siteTags = new Set(site.tags.filter((tag) => tag.length > 0));

    for (const tag of siteTags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort(([tagA, countA], [tagB, countB]) => {
      if (countA !== countB) {
        return countB - countA;
      }

      return tagA.localeCompare(tagB);
    })
    .map(([tag, count]) => ({
      tag,
      count,
      label: `${tag} ${count}`
    }));
}

export function filterSiteTagOptions(
  options: readonly SiteTagOption[],
  query: string
): SiteTagOption[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [...options];
  }

  return options.filter((option) =>
    option.tag.toLowerCase().includes(normalizedQuery)
  );
}
