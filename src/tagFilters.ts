export interface SiteWithTags {
  tags: readonly string[];
}

export interface SiteTagOption {
  tag: string;
  visibleCount: number;
  totalCount: number;
  label: string;
}

export function buildSiteTagOptions<TSite extends SiteWithTags>(
  sites: readonly TSite[],
  isVisibleSite: (site: TSite) => boolean = () => true
): SiteTagOption[] {
  const counts = new Map<string, { visible: number; total: number }>();

  for (const site of sites) {
    const siteTags = new Set(site.tags.filter((tag) => tag.length > 0));
    const visible = isVisibleSite(site);

    for (const tag of siteTags) {
      const count = counts.get(tag) ?? { visible: 0, total: 0 };

      count.total += 1;

      if (visible) {
        count.visible += 1;
      }

      counts.set(tag, count);
    }
  }

  return [...counts.entries()]
    .sort(([tagA, countA], [tagB, countB]) => {
      if (countA.total !== countB.total) {
        return countB.total - countA.total;
      }

      return tagA.localeCompare(tagB);
    })
    .map(([tag, count]) => ({
      tag,
      visibleCount: count.visible,
      totalCount: count.total,
      label: `${tag} ${formatSiteTagCount(count.visible, count.total)}`
    }));
}

export function formatSiteTagCount(visibleCount: number, totalCount: number): string {
  return `${visibleCount}/${totalCount}`;
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
