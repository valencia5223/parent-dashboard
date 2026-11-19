import { useEffect, useState } from 'react';
import { useFetch } from '../api.js';
import { markDirty } from '../account.js';
import { bookAvailability, closedToday, fetchLibraries, fetchPopular, searchBooks } from '../library.js';
import Card, { Body, ErrorBox } from './Card.jsx';

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
const AGES = [
  { id: null, label: '전체' },
  { id: 0, label: '영유아' },
  { id: 6, label: '유아' },
  { id: 8, label: '초등' },
  { id: 14, label: '청소년' },
];

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

function TodayTag({ lib }) {
  const c = closedToday(lib.closed);
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
            {closedToday(lib.closed) != null && ' · '}
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
                        {l.available === false && <span className="med-closing">{l.has ? '대출 중' : '없음'}</span>}
                        {l.available == null && <span>대출 여부 확인 못 함</span>}
                        {' · '}{km(l.distance)}
                        {closedToday(l.closed) === true && ' · 오늘 휴관'}
                      </p>
                    </div>
                    <div className="med-actions">
                      <a className="btn btn-sm" href={mapLink(l)} target="_blank" rel="noreferrer">길찾기</a>
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
  const [age, setAge] = useState(null);
  const state = useFetch(() => fetchPopular(pos, age), [pos.lat, pos.lng, age]);
  return (
    <>
      <p className="lib-sub-title">요즘 우리 지역에서 많이 빌린 책 (최근 30일)</p>
      <div className="chips" role="tablist" aria-label="나이 고르기">
        {AGES.map((a) => (
          <button key={String(a.id)} type="button" role="tab" aria-selected={age === a.id} className={`chip chip-sm${age === a.id ? ' chip-on' : ''}`} onClick={() => setAge(a.id)}>
            {a.label}
          </button>
        ))}
      </div>
      <Body state={state} lines={4}>
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
    <Card title="도서관" icon="📚" onRefresh={() => setRefresh((n) => n + 1)}>
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
      <p className="card-foot">도서관·소장 정보: 도서관 정보나루</p>
    </Card>
  );
}
