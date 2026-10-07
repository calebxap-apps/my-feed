// 소식 출처별로 글 목록을 가져오는 부분.
// 모든 출처는 같은 모양의 글 목록을 돌려준다: { title, url, date, snippet, extra }
import { fetchText, plainText, decodeEntities } from './common.mjs';

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}

// RSS 와 Atom 둘 다 읽는다 (유튜브 채널 피드 포함)
export function parseFeed(xml, snippetLength = 400) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    let url = tag(b, 'link');
    if (!url) {
      const alt = b.match(/<link[^>]*rel=['"]alternate['"][^>]*href=['"]([^'"]+)['"]/i)
        || b.match(/<link[^>]*href=['"]([^'"]+)['"]/i);
      url = alt ? alt[1] : tag(b, 'guid') || tag(b, 'id');
    }
    const date = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const body = tag(b, 'description') || tag(b, 'summary') || tag(b, 'content') || tag(b, 'media:description');
    return {
      title: plainText(tag(b, 'title'), 200),
      url: decodeEntities(url.trim()),
      date: date ? new Date(date).toISOString() : null,
      snippet: plainText(body, snippetLength),
    };
  }).filter((i) => i.title && i.url);
}

// 기사 페이지에서 제목·설명·날짜·본문 앞부분 뽑기
function readArticle(html, maxText = 2000) {
  const meta = (prop) => html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, 'i'))?.[1];
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => plainText(m[1], 2000))
    .filter((t) => t.length > 30);
  return {
    title: meta('og:title') ? decodeEntities(meta('og:title')) : '',
    description: plainText(meta('og:description') || meta('description') || '', 400),
    date: meta('article:published_time') || null,
    text: paragraphs.join(' ').slice(0, maxText),
  };
}

// 페이지에서 '읽을 수 있는 문장들'만 뽑기 (바뀐 부분 비교용)
function pageLines(html) {
  const clean = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ');
  const lines = [...clean.matchAll(/<(h[1-4]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => plainText(m[2], 500))
    .filter((t) => t.length >= 12);
  return [...new Set(lines)];
}

const matches = (keywords, ...texts) =>
  !keywords?.length || keywords.some((k) => texts.join(' ').toLowerCase().includes(k.toLowerCase()));

const fetchers = {
  async feed(src) {
    const items = parseFeed(await fetchText(src.url), src.cleanLinks ? 3000 : src.snippetLength);
    if (src.cleanLinks) {
      // 유튜브 설명란의 '보러 가기 ► 주소' 같은 반복 홍보 문구와 주소를 지운다
      for (const it of items) {
        let text = it.snippet;
        // 매번 똑같이 붙는 소개 문단은 그 지점부터 잘라낸다 (예: "ABOUT THE WINGFEATHER SAGA")
        for (const marker of src.cutFrom || []) {
          const at = text.indexOf(marker);
          if (at >= 0) text = text.slice(0, at);
        }
        for (const phrase of src.remove || []) text = text.split(phrase).join(' ');
        it.snippet = text
          .replace(/[^.!?►]*►\s*\S+/g, ' ')
          .replace(/https?:\/\/\S+/g, ' ')
          .replace(/#\w+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, src.snippetLength ?? 600);
      }
    }
    return items.filter((it) => matches(src.keywords, it.title, it.snippet));
  },

  // RSS 가 없는 목록 페이지: 글 주소만 뽑고, 처음 보는 글만 (최대 5개) 들어가서 내용을 읽는다.
  // 날짜가 없을 수 있어 '이미 본 글' 기록으로 새 글을 가린다.
  async 'link-list'(src, { alreadySeen }) {
    const html = await fetchText(src.url);
    const pattern = new RegExp(`href="(${src.linkPattern})"`, 'g');
    const paths = [...new Set([...html.matchAll(pattern)].map((m) => m[1]))];
    let items = paths.map((p) => ({
      title: p.split('/').pop().replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      url: p.startsWith('http') ? p : `${src.base}${p}`,
      date: null,
      snippet: '',
    }));
    // 주소에 키워드가 있으면 먼저 거른다 (본문까지 읽을 글을 줄이려고)
    if (src.keywords?.length && src.filterBy !== 'content') items = items.filter((it) => matches(src.keywords, it.url));
    const fresh = items.filter((it) => !alreadySeen(it.url)).slice(0, 5);
    await Promise.all(fresh.map(async (it) => {
      try {
        const a = readArticle(await fetchText(it.url), src.detailLength ?? 2000);
        if (a.title) it.title = a.title.replace(/\s*\\?\|\s*[^|]+$/, '').trim(); // 'xxx | 회사명' 꼬리 제거
        it.snippet = src.detailLength === 0 ? a.description : (a.text || a.description);
        if (a.date) it.date = new Date(a.date).toISOString();
      } catch { /* 제목은 주소에서 뽑은 것으로 둔다 */ }
    }));
    return items;
  },

  // 공식 사이트처럼 글 목록이 없는 페이지: 지난번과 비교해 '새로 생긴 문장'이 있으면 소식 하나로 만든다.
  async 'page-watch'(src, { pages, pagesNext }) {
    const lines = pageLines(await fetchText(src.url));
    pagesNext[src.url] = lines;
    const before = pages[src.url];
    if (!before) return []; // 처음 보는 페이지는 기준만 저장
    const old = new Set(before);
    const added = lines.filter((l) => !old.has(l));
    if (!added.length) return [];
    const stamp = new Date().toISOString();
    return [{
      title: `${src.name} 페이지에 새 내용`,
      url: `${src.url}#changed-${stamp.slice(0, 13)}`, // 바뀔 때마다 다른 주소 → 새 소식으로 취급
      link: src.url,
      date: stamp,
      snippet: added.join(' / ').slice(0, 1500),
    }];
  },

  // 한국 OTT 퐁당(fondant.kr): 검색에 걸리는 에피소드 목록. 처음 보는 에피소드 = 한국어판 새로 공개
  async fondant(src, { alreadySeen }) {
    const api = 'https://api.fondant.kr/v1';
    const res = JSON.parse(await fetchText(`${api}/search/media?q=${encodeURIComponent(src.query)}&limit=100`));
    const programs = {};
    const items = [];
    for (const m of res.list || []) {
      const url = `https://www.fondant.kr/media/${m.id}/play`;
      const programId = m.related_ids?.program_uid;
      // 새 에피소드만 프로그램(시즌) 이름을 알아온다
      if (programId && !alreadySeen(url) && !(programId in programs)) {
        try {
          programs[programId] = JSON.parse(await fetchText(`${api}/contents/program/${programId}`)).data?.info?.title || '';
        } catch { programs[programId] = ''; }
      }
      const program = programs[programId] || '';
      const ep = m.stat?.episode_no;
      items.push({
        title: [program, ep ? `${ep}화` : '', m.info?.title].filter(Boolean).join(' · ') || m.info?.title,
        url,
        link: programId ? `https://www.fondant.kr/series/${programId}` : url,
        date: null,
        snippet: plainText(m.info?.desc || '', 300),
      });
    }
    return items;
  },

  // Anthropic 뉴스 (RSS 없음) — link-list 의 한 경우
  async 'anthropic-news'(src, ctx) {
    return fetchers['link-list']({
      ...src, url: 'https://www.anthropic.com/news', linkPattern: '/news/[a-z0-9-]+', base: 'https://www.anthropic.com', detailLength: 0,
    }, ctx);
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
