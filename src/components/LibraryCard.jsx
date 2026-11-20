import { useEffect, useMemo, useState } from 'react';
import { useFetch } from '../api.js';
import { markDirty } from '../account.js';
import { bookAvailability, closedToday, fetchLibraries, fetchPopular, GENRES, lastPopular, searchBooks } from '../library.js';
import Card, { Body, ErrorBox } from './Card.jsx';
import { LibraryIcon } from './icons.jsx';

// 도서관: 책 찾기(근처 어디서 빌릴 수 있나, 인기 대출 책) · 근처 도서관(오늘 여는지) · 읽고 싶은 책(계정 저장)
const TABS = [
  { id: 'find', label: '책 찾기' },
  { id: 'near', label: '근처 도서관' },
  { id: 'wish', label: '읽고 싶은 책' },
];
const TAB_KEY = 'pd_lib_tab';
const FAV_KEY = 'pd_lib_favs'; // [{ code, name }]
const WISH_KEY = 'pd_lib_wish'; // [{ isbn, title, authors, cover }]
const SHOW = 4;

const readList = (k) => { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeList = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 못 해도 괜찮음 */ } markDirty(); };
const km = (d) => (d == null ? '' : d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`);
const mapLink = (o) => `https://map.kakao.com/link/to/${encodeURIComponent(o.name)},${o.lat},${o.lng}`;

// 계정에서 받은 목록으로 바뀌면 다시 읽는 localStorage 목록
function useSyncedList(key) {
  const [list, setList] = useState(() => readList(key));
  useEffect(() => {
    const re = () => setList(readList(key));
    window.addEventListener('pd-data', re);
    return () => window.removeEventListener('pd-data', re);
  }, [key]);
  const save = (next) => { setList(next); writeList(key, next); };
  return [list, save];
}

// 도서관 홈페이지 자료는 실제 휴관 날짜(todayClosed), 정보나루는 휴관일 글로 계산
const isClosedToday = (lib) => (lib.todayClosed != null ? lib.todayClosed : closedToday(lib.closed));
function TodayTag({ lib }) {
  const c = isClosedToday(lib);
  if (c === true) return <span className="med-closing">오늘 휴관</span>;
  if (c === false) return <span className="med-open">오늘 열어요</span>;
  return null;
}

function LibraryRow({ lib, fav, onFav }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="lib-row">
      <div className="lib-line">
        <button type="button" className="lib-star" onClick={() => onFav(lib)} aria-pressed={fav} aria-label={fav ? `${lib.name} 즐겨찾기 빼기` : `${lib.name} 즐겨찾기`}>
          {fav ? '★' : '☆'}
        </button>
        <button type="button" className="med-main lib-open-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          <p className="med-name">{lib.name}</p>
          <p className="med-meta">
            <TodayTag lib={lib} />
            {isClosedToday(lib) != null && ' · '}
            {km(lib.distance)}
          </p>
        </button>
        <div className="med-actions">
          {lib.tel && <a className="btn btn-sm" href={`tel:${lib.tel}`} aria-label={`${lib.name} 전화`}>📞</a>}
          <a className="btn btn-sm" href={mapLink(lib)} target="_blank" rel="noreferrer">길찾기</a>
        </div>
      </div>
      {open && (
        <dl className="lib-detail">
          {lib.hours && (<><dt>운영</dt><dd>{lib.hours}</dd></>)}
          {lib.closed && (<><dt>휴관</dt><dd>{lib.closed}</dd></>)}
          {lib.address && (<><dt>주소</dt><dd>{lib.address}</dd></>)}
          {lib.homepage && (<><dt>누리집</dt><dd><a href={/^https?:/.test(lib.homepage) ? lib.homepage : `http://${lib.homepage}`} target="_blank" rel="noreferrer">{lib.homepage}</a></dd></>)}
        </dl>
      )}
    </li>
  );
}

function Nearby({ pos, favs, setFavs }) {
  const state = useFetch(() => fetchLibraries(pos), [pos.lat, pos.lng]);
  const [all, setAll] = useState(false);
  const favCodes = new Set(favs.map((f) => f.code));
  const toggle = (l) => setFavs(favCodes.has(l.code) ? favs.filter((f) => f.code !== l.code) : [...favs, { code: l.code, name: l.name }]);
  return (
    <Body state={state} lines={4}>
      {(list) => {
        if (list.length === 0) return <p className="empty">10km 안에서 도서관을 찾지 못했어요</p>;
        const sorted = [...list].sort((a, b) => (favCodes.has(b.code) - favCodes.has(a.code)) || a.distance - b.distance);
        const shown = all ? sorted : sorted.slice(0, SHOW);
        return (
          <>
            <ul className="med-list">
              {shown.map((l) => <LibraryRow key={l.code} lib={l} fav={favCodes.has(l.code)} onFav={toggle} />)}
            </ul>
            {sorted.length > SHOW && (
              <button type="button" className="btn btn-block" onClick={() => setAll(!all)} aria-expanded={all}>
                {all ? '접기' : `${sorted.length - SHOW}곳 더 보기`}
              </button>
            )}
            <p className="card-foot">휴관일은 도서관이 적어 둔 글로 계산해요. 임시 휴관은 다를 수 있어요. ☆ 를 누르면 맨 위에 두고 책 찾을 때 먼저 확인해요.</p>
          </>
        );
      }}
    </Body>
  );
}

// 책이 꽂힌 곳(군포시도서관처럼 도서관 홈페이지 자료가 있는 곳만): 자료실 · 서가 · 청구기호, 서가 안내 그림
// '종합자료실 33번 서가'·'종합자료실11'(자료실 이름과 겹침) → '33번 서가'·'11번 서가', '38' → '38번 서가'
const shelfText = (room, shelf) => {
  let s = shelf.trim();
  const word = room.split(/[\s(]/).find((w) => w.length >= 3 && s.startsWith(w));
  if (word) s = s.slice(word.length).trim();
  return /^\d+$/.test(s) ? `${s}번 서가` : s;
};
const dueText = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
// 같은 자리(자료실·서가·청구기호에서 'c.2' 같은 복본 번호를 뺀 것)끼리 한 줄로
function groupCopies(copies) {
  const out = new Map();
  for (const c of copies) {
    const callNo = c.callNo.replace(/\s+c\.\d+$/i, '');
    const k = `${c.room}|${c.shelf}|${callNo}`;
    if (!out.has(k)) out.set(k, { room: c.room, shelf: c.shelf ? shelfText(c.room, c.shelf) : '', callNo, map: c.map, list: [] });
    out.get(k).list.push(c);
  }
  // 빌릴 수 있는 책이 많은 자리 먼저
  const ready = (g) => g.list.filter((c) => c.ready).length;
  return [...out.values()].sort((x, y) => ready(y) - ready(x) || y.list.length - x.list.length);
}
function BookCopies({ copies }) {
  const [map, setMap] = useState(null);
  const groups = groupCopies(copies);
  return (
    <ul className="lib-copies">
      {groups.map((g, i) => {
        const ready = g.list.filter((c) => c.ready).length;
        const dues = g.list.filter((c) => !c.ready && c.due).map((c) => c.due).sort();
        const state = g.list.length > 1
          ? `${g.list.length}권 중 ${ready}권 빌릴 수 있음`
          : ready ? '' : g.list[0].state.replace('대출중', '대출 중');
        return (
          <li key={i}>
            📍 {[g.room, g.shelf].filter(Boolean).join(' · ')}
            {g.callNo && <> · <b className="lib-callno">{g.callNo}</b></>}
            {(state || (!ready && dues.length > 0)) && (
              <span className="muted"> · {state}{!ready && dues.length > 0 && `${state ? ', ' : ''}${dueText(dues[0])} 반납 예정`}</span>
            )}
            {g.list.some((c) => c.hold) && <span className="lib-svc" title="반납되면 내 차례로 잡아 둠(홈페이지에서 로그인 후 신청)">예약 가능</span>}
            {g.list.some((c) => c.pre) && <span className="lib-svc" title="홈페이지에서 로그인 후 신청">선예약 가능</span>}
            {g.list.some((c) => c.ibl) && <span className="lib-svc" title="이 책을 내가 다니는 군포 도서관으로 보내 받기(홈페이지에서 로그인 후 신청)">상호대차 가능</span>}
            {g.map && (
              <button type="button" className="link-btn" onClick={() => setMap(map === i ? null : i)} aria-expanded={map === i}>
                {map === i ? '서가 그림 닫기' : '서가 위치 보기'}
              </button>
            )}
            {map === i && <a href={g.map} target="_blank" rel="noreferrer" title="크게 보기"><img className="lib-shelf-map" src={g.map} alt={`${g.room} ${g.shelf} 위치 안내`} loading="lazy" /></a>}
          </li>
        );
      })}
    </ul>
  );
}

// 근처에서 이 책을 가진 도서관과 대출 가능 여부
function Availability({ pos, isbn, favCodes }) {
  const state = useFetch(() => bookAvailability(pos, isbn, favCodes), [pos.lat, pos.lng, isbn]);
  const [all, setAll] = useState(false);
  return (
    <div className="lib-avail">
      <Body state={state} lines={2}>
        {({ libs }) => {
          if (libs.length === 0) return <p className="empty">근처 10km 도서관에는 이 책이 없어요</p>;
          const shown = all ? libs : libs.slice(0, SHOW);
          const yes = libs.filter((l) => l.available).length;
          return (
            <>
              <p className="med-sub">근처 {libs.length}곳에 있어요{yes > 0 && <> · <b>{yes}곳에서 지금 빌릴 수 있어요</b></>}</p>
              <ul className="med-list">
                {shown.map((l) => (
                  <li key={l.code}>
                    <div className="med-main">
                      <p className="med-name">{favCodes.includes(l.code) && '★ '}{l.name}</p>
                      <p className="med-meta">
                        {l.available === true && <span className="med-open">대출 가능</span>}
                        {l.available === false && <span className="med-closing">{l.state || (l.has ? '대출 중' : '없음')}</span>}
                        {l.available == null && <span>대출 여부 확인 못 함</span>}
                        {' · '}{km(l.distance)}
                        {isClosedToday(l) === true && ' · 오늘 휴관'}
                      </p>
                      {l.copies?.length > 0 && <BookCopies copies={l.copies} />}
                    </div>
                    <div className="med-actions">
                      <a className="btn btn-sm" href={mapLink(l)} target="_blank" rel="noreferrer">길찾기</a>
                      {l.reserveUrl && (
                        <a className={`btn btn-sm${l.available ? '' : ' btn-primary'}`} href={l.reserveUrl} target="_blank" rel="noreferrer" title="도서관 홈페이지에서 로그인 후 예약·상호대차">예약하러 가기</a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {libs.length > SHOW && (
                <button type="button" className="btn btn-sm btn-block" onClick={() => setAll(!all)} aria-expanded={all}>
                  {all ? '접기' : `${libs.length - SHOW}곳 더 보기`}
                </button>
              )}
            </>
          );
        }}
      </Body>
    </div>
  );
}

function BookRow({ book, pos, favCodes, wished, onWish, rank, autoOpen }) {
  const [open, setOpen] = useState(!!autoOpen);
  return (
    <li className="book-row">
      <div className="book-line">
        {book.cover ? <img className="book-cover" src={book.cover} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <div className="book-cover" aria-hidden />}
        <div className="book-main">
          <p className="book-title">{rank != null && <span className="book-rank">{rank}</span>}{book.title}</p>
          <p className="med-meta">{[book.authors, book.publisher, book.year].filter(Boolean).join(' · ')}</p>
          <div className="book-actions">
            <button type="button" className={`btn btn-sm${open ? ' btn-on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? '접기' : '어디서 빌리나'}
            </button>
            <button type="button" className={`btn btn-sm btn-fav${wished ? ' btn-fav-on' : ''}`} onClick={() => onWish(book)} aria-pressed={wished}>
              {wished ? '★ 담음' : '☆ 읽고 싶어요'}
            </button>
          </div>
        </div>
      </div>
      {open && <Availability pos={pos} isbn={book.isbn} favCodes={favCodes} />}
    </li>
  );
}

function BookList({ books, pos, favCodes, wish, onWish, ranked, autoOpen = 0 }) {
  const wished = new Set(wish.map((b) => b.isbn));
  return (
    <ul className="book-list">
      {books.map((b, i) => (
        <BookRow key={b.isbn} book={b} pos={pos} favCodes={favCodes} wished={wished.has(b.isbn)} onWish={onWish} rank={ranked ? i + 1 : null} autoOpen={i < autoOpen} />
      ))}
    </ul>
  );
}

function Popular({ pos, ...rest }) {
  const [genre, setGenre] = useState(() => { try { return localStorage.getItem('pd_lib_genre') || 'all'; } catch { return 'all'; } });
  const pickGenre = (id) => { setGenre(id); try { localStorage.setItem('pd_lib_genre', id); } catch { /* 괜찮음 */ } };
  const state = useFetch(() => fetchPopular(pos, genre), [pos.lat, pos.lng, genre]);
  // 새 순위를 받는 동안(날짜가 바뀌면 10초 넘게 걸림)·못 받았을 때는 지난번 목록을 먼저 보여 준다
  const stale = useMemo(() => lastPopular(genre), [genre]);
  const useStale = !!stale && (state.loading || (state.error && state.data == null));
  const view = useStale ? { ...state, data: stale, error: state.loading ? null : state.error } : state;
  return (
    <>
      <p className="lib-sub-title">요즘 우리 지역에서 많이 빌린 책 (최근 30일)</p>
      <div className="chips" role="tablist" aria-label="장르 고르기">
        {GENRES.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={genre === a.id} className={`chip chip-sm${genre === a.id ? ' chip-on' : ''}`} onClick={() => pickGenre(a.id)}>
            {a.label}
          </button>
        ))}
      </div>
      {useStale && state.loading && <p className="muted lib-refresh">새 순위를 받는 중… (지난번 목록)</p>}
      <Body state={view} lines={4}>
        {(books) => (books.length === 0 ? <p className="empty">인기 대출 자료가 아직 없어요</p> : <BookList books={books.slice(0, 10)} pos={pos} ranked {...rest} />)}
      </Body>
    </>
  );
}

function Finder({ pos, ...rest }) {
  const [q, setQ] = useState('');
  const [st, setSt] = useState({ q: '', loading: false, list: null, error: null });
  const search = async (e) => {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    setSt({ q: text, loading: true, list: null, error: null });
    try { setSt({ q: text, loading: false, list: await searchBooks(text), error: null }); } catch (err) { setSt({ q: text, loading: false, list: null, error: err }); }
  };
  const clear = () => { setQ(''); setSt({ q: '', loading: false, list: null, error: null }); };
  const showing = st.loading || st.list || st.error;
  return (
    <>
      <form className="place-search" onSubmit={search} role="search">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="책 제목·지은이 (예: 구름빵, 한강)" aria-label="책 찾기" enterKeyHint="search" />
        <button type="submit" className="btn btn-primary" disabled={st.loading}>찾기</button>
      </form>
      {showing && (
        <div className="lib-results">
          <div className="lib-results-head">
            <p className="lib-sub-title">‘{st.q}’ 찾은 책</p>
            <button type="button" className="btn btn-sm" onClick={clear}>인기 책 보기</button>
          </div>
          {st.loading && <p className="empty">찾는 중…</p>}
          {st.error && <ErrorBox error={st.error} />}
          {st.list && (st.list.length === 0 ? <p className="empty">찾지 못했어요. 제목을 짧게 넣어 보세요.</p> : <BookList books={st.list} pos={pos} {...rest} />)}
        </div>
      )}
      {!showing && <Popular pos={pos} {...rest} />}
    </>
  );
}

function Wish({ pos, wish, ...rest }) {
  if (wish.length === 0) {
    return (
      <div className="empty">
        <p>아직 담은 책이 없어요.</p>
        <small>‘책 찾기’에서 ☆ 읽고 싶어요 를 누르면 여기에 모이고, 근처 어디서 빌릴 수 있는지 바로 확인할 수 있어요. 계정에 저장돼 폰·PC 어디서나 보여요.</small>
      </div>
    );
  }
  // 앞의 5권은 바로 근처 대출 여부를 보여 준다(하루 호출 한도 때문에 전부는 아님)
  return <BookList books={wish} pos={pos} wish={wish} autoOpen={5} {...rest} />;
}

export default function LibraryCard({ pos }) {
  const [tab, setTab] = useState(() => { try { const v = localStorage.getItem(TAB_KEY); return TABS.some((t) => t.id === v) ? v : 'find'; } catch { return 'find'; } });
  const [refresh, setRefresh] = useState(0);
  const [favs, setFavs] = useSyncedList(FAV_KEY);
  const [wish, setWish] = useSyncedList(WISH_KEY);
  const pick = (id) => { setTab(id); try { localStorage.setItem(TAB_KEY, id); } catch { /* 괜찮음 */ } };
  const favCodes = favs.map((f) => f.code);
  const onWish = (b) => setWish(wish.some((w) => w.isbn === b.isbn)
    ? wish.filter((w) => w.isbn !== b.isbn)
    : [{ isbn: b.isbn, title: b.title, authors: b.authors, publisher: b.publisher, year: b.year, cover: b.cover }, ...wish]);
  const shared = { favCodes, wish, onWish };

  return (
    <Card title="도서관" icon={<LibraryIcon />} onRefresh={() => setRefresh((n) => n + 1)}>
      <div className="chips" role="tablist" aria-label="도서관 보기 고르기">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`chip${tab === t.id ? ' chip-on' : ''}`} onClick={() => pick(t.id)}>
            {t.id === 'wish' && wish.length > 0 ? `${t.label} ${wish.length}` : t.label}
          </button>
        ))}
      </div>
      <div key={`${tab}${refresh}`}>
        {tab === 'near' && <Nearby pos={pos} favs={favs} setFavs={setFavs} />}
        {tab === 'find' && <Finder pos={pos} {...shared} />}
        {tab === 'wish' && <Wish pos={pos} {...shared} />}
      </div>
      <p className="card-foot">도서관·소장 정보: 도서관 정보나루 · 군포시립도서관(산본·당동 등)은 군포시도서관 홈페이지</p>
    </Card>
  );
}
