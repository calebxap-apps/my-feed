// 소식 출처별로 글 목록을 가져오는 부분.
// 모든 출처는 같은 모양의 글 목록을 돌려준다: { title, url, date, snippet, extra }
import { fetchText, plainText, decodeEntities } from './common.mjs';

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}

// RSS 와 Atom 둘 다 읽는다
export function parseFeed(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    let url = tag(b, 'link');
    if (!url) {
      const alt = b.match(/<link[^>]*rel=['"]alternate['"][^>]*href=['"]([^'"]+)['"]/i)
        || b.match(/<link[^>]*href=['"]([^'"]+)['"]/i);
      url = alt ? alt[1] : tag(b, 'guid') || tag(b, 'id');
    }
    const date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    return {
      title: plainText(tag(b, 'title'), 200),
      url: decodeEntities(url.trim()),
      date: date ? new Date(date).toISOString() : null,
      snippet: plainText(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'), 400),
    };
  }).filter((i) => i.title && i.url);
}

const fetchers = {
  async feed(src) {
    return parseFeed(await fetchText(src.url));
  },

  // Anthropic 뉴스는 RSS 가 없어서 목록 페이지에서 글 주소만 뽑는다 (날짜 없음 → '이미 본 글' 기록으로 새 글을 가린다)
  async 'anthropic-news'(src, { alreadySeen }) {
    const html = await fetchText('https://www.anthropic.com/news');
    const paths = [...new Set([...html.matchAll(/href="(\/news\/[a-z0-9-]+)"/g)].map((m) => m[1]))];
    const items = paths.map((p) => ({
      title: p.split('/').pop().replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      url: `https://www.anthropic.com${p}`,
      date: null,
      snippet: '',
    }));
    // 처음 보는 글만 (최대 5개) 본문 페이지에 들어가 진짜 제목·설명을 가져온다
    const fresh = items.filter((it) => !alreadySeen(it.url)).slice(0, 5);
    await Promise.all(fresh.map(async (it) => {
      try {
        const page = await fetchText(it.url);
        const meta = (prop) => page.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i'))?.[1];
        const title = meta('og:title');
        if (title) it.title = decodeEntities(title).replace(/\s*\\?\|\s*Anthropic\s*$/, '').trim();
        it.snippet = plainText(meta('og:description') || meta('description') || '', 400);
      } catch { /* 제목은 주소에서 뽑은 것으로 둔다 */ }
    }));
    return items;
  },

  // Hacker News 첫 화면 글 중 점수(개발자 추천)가 높은 것만
  async hackernews(src, { since }) {
    const after = Math.floor(since.getTime() / 1000);
    const url = `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=50`
      + `&numericFilters=points>=${src.minPoints ?? 150},created_at_i>${after}`;
    const data = JSON.parse(await fetchText(url));
    return data.hits.map((h) => ({
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      date: h.created_at,
      snippet: h.story_text ? plainText(h.story_text, 300) : '',
      extra: { points: h.points, comments: h.num_comments, discussion: `https://news.ycombinator.com/item?id=${h.objectID}` },
    })).sort((a, b) => b.extra.points - a.extra.points);
  },

  // 최근 며칠 사이 새로 생겨 별(추천)을 많이 받은 GitHub 프로젝트
  async 'github-new-repos'(src) {
    const from = new Date(Date.now() - (src.days ?? 7) * 864e5).toISOString().slice(0, 10);
    const q = encodeURIComponent(`created:>${from} stars:>=${src.minStars ?? 300}`);
    const data = JSON.parse(await fetchText(
      `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=20`
    ));
    return data.items.map((r) => ({
      title: `${r.full_name}${r.description ? ' — ' + r.description : ''}`.slice(0, 200),
      url: r.html_url,
      date: null, // 프로젝트는 생성일이 아니라 '처음 본 날'로 새 소식 여부를 판단
      snippet: [r.language, `★${r.stargazers_count}`, (r.topics || []).slice(0, 5).join(', ')].filter(Boolean).join(' · '),
      extra: { stars: r.stargazers_count },
    }));
  },
};

export async function fetchSource(src, ctx) {
  const fn = fetchers[src.type];
  if (!fn) throw new Error(`모르는 출처 종류: ${src.type}`);
  return fn(src, ctx);
}
