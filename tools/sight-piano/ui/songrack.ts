/**
 * 识谱琴房 —— LCD 屏里的曲目卡片架。
 *
 * 与和弦琴房的卡片架同一血统，但手势更简单：单击选曲。
 * 卡片显示：曲名 + 副标题（调性/难度分组）+ 历史最好星级。
 * 分组用极小的组标隔开（C 大调 / G 大调 …… 我的曲库）。
 */

export interface SongCardItem {
  id: string;
  name: string;
  sub: string;
  /** 历史最好星级 0-3 */
  stars: number;
  /** 是否当前选中 */
  active: boolean;
  /** 分组标（每组第一张卡前显示） */
  group?: string | null;
  tip?: string;
}

export interface SongRackView {
  el: HTMLElement;
  render(items: readonly SongCardItem[]): void;
}

export function createSongRack(onSelect: (id: string) => void): SongRackView {
  const el = document.createElement('div');
  el.className = 'sp-songrack';
  el.setAttribute('role', 'listbox');
  el.setAttribute('aria-label', '曲目卡片架：单击选曲');

  return {
    el,

    render(items: readonly SongCardItem[]): void {
      const nodes: HTMLElement[] = [];
      let lastGroup: string | null = null;
      for (const it of items) {
        if (it.group && it.group !== lastGroup) {
          lastGroup = it.group;
          const gh = document.createElement('span');
          gh.className = 'sp-songgroup';
          gh.textContent = it.group;
          nodes.push(gh);
        }
        const card = document.createElement('button');
        card.type = 'button';
        card.className =
          'sp-songcard' + (it.active ? ' sp-songcard-on' : '');
        card.dataset.songId = it.id;
        card.title = it.tip ?? '单击选中这首曲子';
        card.setAttribute('role', 'option');
        card.setAttribute('aria-selected', String(it.active));

        const name = document.createElement('div');
        name.className = 'sp-songcard-name';
        name.textContent = it.name;
        const sub = document.createElement('div');
        sub.className = 'sp-songcard-sub';
        sub.textContent = it.sub;
        const stars = document.createElement('div');
        stars.className = 'sp-songcard-stars';
        stars.textContent = it.stars > 0 ? '★'.repeat(it.stars) + '☆'.repeat(3 - it.stars) : '☆☆☆';
        stars.style.opacity = it.stars > 0 ? '1' : '.35';
        card.append(name, sub, stars);
        card.addEventListener('click', () => onSelect(it.id));
        nodes.push(card);
      }
      el.replaceChildren(...nodes);
      // 让选中卡滚进可视区
      const active = el.querySelector<HTMLElement>('.sp-songcard-on');
      active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
  };
}
