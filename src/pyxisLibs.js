// 도서관 정보나루에 없는 도서관을 그 시의 도서관 홈페이지 자료로 채운다.
// 군포시립도서관(산본·당동·대야·부곡·어린이·작은도서관 등)은 정보나루에 중앙도서관만 있어서,
// 군포시도서관 홈페이지가 쓰는 Pyxis 자료(https://www.gunpolib.go.kr/pyxis-api, 로그인 없이 공개, CORS 허용)를 브라우저에서 바로 부른다.
//   1/collections/1/search?all=k|a|<ISBN>  책 검색 → 지점별 상태(branchVolumes: cState '대출가능'·'대출중'·'관내열람' …)
//   branches/<id>/close-days?year&month   그 달의 휴관 날짜
// 공식 API 가 아니라 홈페이지가 바뀌면 멈출 수 있다. 실패하면 조용히 빼고 정보나루 결과만 보여 준다.
// 지점 위치는 홈페이지 자료에 없어서 카카오 장소 검색으로 한 번 찾아 넣었다(2026-11).
import { cached, FetchError } from './sources.js';

export const PYXIS_SYSTEMS = [
  {
    id: 'gp',
    city: '군포시',
    api: 'https://www.gunpolib.go.kr/pyxis-api',
    site: 'https://www.gunpolib.go.kr',
    center: { lat: 37.355, lng: 126.935 },
    // 정보나루에도 있는 같은 도서관(이쪽 자료가 실시간이라 이쪽을 쓰고 정보나루 것은 뺀다)
    replaces: ['141135'],
    // [지점 id, 이름, 주소, 위도, 경도]
    branches: [
      [6, '군포시중앙도서관', '경기 군포시 수리산로 79', 37.3554, 126.9158],
      [1, '군포시산본도서관', '경기 군포시 광정로 96', 37.3615, 126.9287],
      [2, '군포시당동도서관', '경기 군포시 산본로197번길 36', 37.3537, 126.9452],
      [3, '군포시대야도서관', '경기 군포시 대야2로 139', 37.3304, 126.9152],
      [9, '군포부곡도서관', '경기 군포시 송부로221번길 3-10', 37.3241, 126.9357],
      [4, '군포시어린이도서관', '경기 군포시 고산로677번길 21', 37.3722, 126.9321],
      [10, '당정문화도서관', '경기 군포시 한세로56번길 12', 37.3472, 126.9548],
      [11, '군포2동 채움작은도서관', '경기 군포시 고산로 263', 37.3463, 126.9431],
      [12, '금정작은도서관', '경기 군포시 금산로 35', 37.3654, 126.9394],
      [13, '재궁꿈나무도서관', '경기 군포시 번영로550번길 25', 37.3585, 126.9391],
      [15, '노루목작은도서관', '경기 군포시 산본천로 207', 37.3711, 126.9403],
      [16, '작은도서관 버드나무에 부는 바람', '경기 군포시 금산로 18-1', 37.3642, 126.9409],
      [18, '우리마을작은도서관', '경기 군포시 곡란로8번길 35-10', 37.3755, 126.938],
      [21, '하늘정원작은도서관', '경기 군포시 군포로476번길 2', 37.3487, 126.9443],
      [23, '꿈드림작은도서관', '경기 군포시 용호1로21번길 14', 37.3451, 126.9365],
      [25, '영어가족도서관', '경기 군포시 번영로200번길 72', 37.3359, 126.9338],
    ],
  },
];

const kmBetween = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 88);
// 위치에서 20km 안에 있는 시스템만 쓴다
export const systemsNear = (pos) => PYXIS_SYSTEMS.filter((s) => kmBetween(pos, s.center) <= 20);

async function getJSON(url) {
  let res;
  try { res = await fetch(url, { headers: { Accept: 'application/json' } }); } catch { throw new FetchError('도서관 홈페이지에 연결하지 못했어요'); }
  if (!res.ok) throw new FetchError(`도서관 홈페이지 오류 (${res.status})`);
  const j = await res.json();
  if (j?.success === false) throw new FetchError(j.message || '도서관 홈페이지 오류');
  return j?.data;
}

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// 이번 달 휴관 날짜(하루 보관)
function closeDays(sys, bid) {
  const t = kstToday();
  return cached(`pyx:close:${sys.id}:${bid}:${t.slice(0, 7)}`, 24 * 3600e3, async () => {
    const d = await getJSON(`${sys.api}/branches/${bid}/close-days?year=${t.slice(0, 4)}&month=${t.slice(5, 7)}`);
    return (d?.list || []).map((x) => ({ date: String(x.libraryDate || '').slice(0, 10), reason: x.closeReason || '' }));
  }, { persist: true });
}

// 정보나루 도서관과 같은 모양의 목록(code 는 'gp:1' 처럼), 오늘 휴관 여부는 실제 휴관 날짜로
export async function pyxisLibraries(sys) {
  const t = kstToday();
  return Promise.all(sys.branches.map(async ([bid, name, address, lat, lng]) => {
    let todayClosed = null;
    let closedNote = '';
    try {
      const days = await closeDays(sys, bid);
      const hit = days.find((d) => d.date === t);
      todayClosed = !!hit;
      const rest = days.filter((d) => d.date >= t).map((d) => `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8))}`);
      closedNote = rest.length ? `이번 달 남은 휴관일: ${rest.join(', ')}` : '이번 달 남은 휴관일 없음';
    } catch { /* 휴관일을 못 받아도 목록은 보여 준다 */ }
    return {
      code: `${sys.id}:${bid}`, name, address, lat, lng, tel: '', homepage: sys.site,
      closed: closedNote, hours: '', todayClosed, source: sys.city,
    };
  }));
}

// 이 책(ISBN)이 지점마다 있는지·지금 빌릴 수 있는지(10분 보관). { [code]: { has, available, state, copies } }
// copies: 책 한 권마다 위치 [{ room: '2층 종합자료실(일반도서)', shelf: '종합자료실 33번 서가', callNo, state, due, map }]
//   (1/biblios/<id>/items, 지점 id 별로 묶여 옴. 실패하면 위치 없이 상태만)
export function pyxisAvailability(sys, isbn) {
  return cached(`pyx:isbn2:${sys.id}:${isbn}`, 10 * 60e3, async () => {
    const q = new URLSearchParams({ all: `k|a|${isbn}`, max: '50' });
    const d = await getJSON(`${sys.api}/1/collections/1/search?${q}`);
    const out = {};
    const biblios = [];
    for (const b of d?.list || []) {
      if (String(b.isbn || '').replace(/\D/g, '') !== isbn) continue;
      biblios.push(b.id);
      for (const v of b.branchVolumes || []) {
        const code = `${sys.id}:${v.id}`;
        const ready = v.cStateCode === 'READY';
        const prev = out[code];
        // 한 지점에 여러 권이면 한 권이라도 빌릴 수 있으면 '대출 가능'
        if (!prev || (ready && !prev.available)) out[code] = { has: true, available: ready, state: ready ? '대출 가능' : String(v.cState || '대출 불가').replace('대출중', '대출 중'), copies: prev?.copies || [] };
      }
    }
    await Promise.all(biblios.slice(0, 20).map(async (id) => {
      try {
        const items = await getJSON(`${sys.api}/1/biblios/${id}/items`);
        for (const [bid, list] of Object.entries(items || {})) {
          const lib = out[`${sys.id}:${bid}`];
          if (!lib || !Array.isArray(list)) continue;
          for (const it of list) {
            const map = it.shelf?.attachment?.[0]?.originalImageUrl;
            lib.copies.push({
              room: String(it.location?.name || '').replace(/\([^()]*\)$/, '').trim(), // 끝의 '(산본)' 같은 지점 이름은 뺌
              shelf: it.shelf?.name || '',
              callNo: it.callNo || '',
              state: it.circulationState?.name || it.itemState?.name || '',
              ready: it.circulationState?.code === 'READY',
              due: it.dueDate ? String(it.dueDate).slice(0, 10) : '',
              map: map ? `${sys.api}${map}` : '',
            });
          }
        }
      } catch { /* 위치를 못 받아도 대출 상태는 보여 준다 */ }
    }));
    return out;
  });
}
