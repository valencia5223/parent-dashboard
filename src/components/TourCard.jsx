import { useEffect, useState } from 'react';
import { useFetch } from '../api.js';
import { markDirty } from '../account.js';
import { fetchFestivals, fetchSpotDetail, fetchSpots } from '../tour.js';
import Card, { Body } from './Card.jsx';

// 나들이: 근처 축제·행사 / 가볼 곳(관광지·문화시설·체험) / 가보고 싶은 곳(계정 저장). 자료: 한국관광공사
const TABS = [
  { id: 'fest', label: '축제·행사' },
  { id: 'spot', label: '가볼 곳' },
  { id: 'saved', label: '가볼 목록' },
];
const KINDS = [
  { id: '12', label: '관광지·공원' },
  { id: '14', label: '박물관·전시' },
  { id: '28', label: '체험·레포츠' },
];
const TAB_KEY = 'pd_tour_tab';
const SAVED_KEY = 'pd_tour_saved';
const SHOW = 5;

const readList = () => { try { const v = JSON.parse(localStorage.getItem(SAVED_KEY)); return Array.isArray(v) ? v : []; } catch { return []; } };
const km = (d) => (d == null ? '' : d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`);
const mapLink = (o) => (o.lat && o.lng ? `https://map.kakao.com/link/to/${encodeURIComponent(o.title)},${o.lat},${o.lng}` : `https://map.kakao.com/?q=${encodeURIComponent(o.title)}`);
const md = (s) => (s && s.length === 8 ? `${Number(s.slice(4, 6))}/${Number(s.slice(6))}` : '');
const todayYmd = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
function dday(start) {
  const a = Date.UTC(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6));
  const t = todayYmd();
  const b = Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6));
  return Math.round((a - b) / 86400e3);
}
// 축제 날짜 글: '진행 중 · ~11/30' / '내일 시작 · 11/20~11/24' / 'D-5 · …'
function festWhen(f) {
  if (!f.start) return null;
  const range = f.end && f.end !== f.start ? `${md(f.start)}~${md(f.end)}` : md(f.start);
  const t = todayYmd();
  if (f.start <= t) return { on: true, text: `진행 중 · ${f.end ? `~${md(f.end)}` : range}`, last: f.end === t };
  const d = dday(f.start);
  return { on: false, text: `${d === 1 ? '내일 시작' : d <= 7 ? `${d}일 뒤 시작` : `D-${d}`} · ${range}` };
}

// '가능', '불가', '있음' 같은 짧은 답만 꼬리표로
const yes = (v) => /가능|있음|대여|무료/.test(v) && !/불가|없음/.test(v);
function Detail({ spot }) {
  const state = useFetch(() => fetchSpotDetail(spot), [spot.id]);
  const [more, setMore] = useState(false);
  return (
    <div className="tour-detail">
      <Body state={state} lines={3}>
        {(d) => {
          const tags = [
            d.stroller && { on: yes(d.stroller), text: `유모차 ${yes(d.stroller) ? '가능' : d.stroller.length <= 8 ? d.stroller : '확인'}` },
            d.pet && { on: yes(d.pet), text: `반려동물 ${yes(d.pet) ? '가능' : d.pet.length <= 8 ? d.pet : '확인'}` },
            d.parking && { on: yes(d.parking), text: `주차 ${yes(d.parking) ? '가능' : d.parking.length <= 8 ? d.parking : '확인'}` },
          ].filter(Boolean);
          const long = d.overview.length > 160;
          return (
            <>
              {tags.length > 0 && (
                <div className="tour-tags">
                  {tags.map((t) => <span key={t.text} className={`tour-tag${t.on ? ' tour-tag-on' : ''}`}>{t.text}</span>)}
                </div>
              )}
              <dl className="lib-detail tour-dl">
                {d.place && (<><dt>장소</dt><dd>{d.place}</dd></>)}
                {d.hours && (<><dt>시간</dt><dd>{d.hours}</dd></>)}
                {d.rest && (<><dt>쉬는 날</dt><dd>{d.rest}</dd></>)}
                {d.fee && (<><dt>요금</dt><dd>{d.fee}</dd></>)}
                {d.age && (<><dt>나이</dt><dd>{d.age}</dd></>)}
                {spot.addr && (<><dt>주소</dt><dd>{spot.addr}</dd></>)}
              </dl>
              {d.overview && (
                <p className="tour-overview">
                  {more || !long ? d.overview : `${d.overview.slice(0, 160)}…`}
                  {long && <button type="button" className="link-btn" onClick={() => setMore(!more)}>{more ? ' 접기' : ' 더 읽기'}</button>}
                </p>
              )}
              <div className="book-actions">
                {(d.tel || spot.tel) && <a className="btn btn-sm" href={`tel:${(d.tel || spot.tel).split(/[,\n]/)[0].replace(/[^\d-]/g, '')}`}>📞 전화</a>}
                {d.homepage && <a className="btn btn-sm" href={d.homepage} target="_blank" rel="noreferrer">누리집</a>}
              </div>
            </>
          );
        }}
      </Body>
    </div>
  );
}

function SpotRow({ spot, saved, onSave }) {
  const [open, setOpen] = useState(false);
  const when = festWhen(spot);
  return (
    <li className="book-row">
      <div className="book-line">
        <button type="button" className="tour-thumb-btn" onClick={() => setOpen(!open)} aria-label={`${spot.title} 자세히`}>
          {spot.image ? <img className="tour-thumb" src={spot.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <div className="tour-thumb" aria-hidden />}
        </button>
        <div className="book-main">
          <button type="button" className="lib-open-btn tour-title-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
            <p className="book-title">{spot.title}</p>
          </button>
          <p className="med-meta">
            {when && <><span className={when.on ? 'med-open' : 'tour-soon'}>{when.text}</span>{when.last && <span className="med-closing"> · 오늘 끝나요</span>} · </>}
            {km(spot.distance)}
          </p>
          <div className="book-actions">
            <button type="button" className={`btn btn-sm${open ? ' btn-on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '접기' : '자세히'}</button>
            <a className="btn btn-sm" href={mapLink(spot)} target="_blank" rel="noreferrer">길찾기</a>
            <button type="button" className={`btn btn-sm btn-fav${saved ? ' btn-fav-on' : ''}`} onClick={() => onSave(spot)} aria-pressed={saved}>{saved ? '★' : '☆'}</button>
          </div>
        </div>
      </div>
      {open && <Detail spot={spot} />}
    </li>
  );
}

function SpotList({ list, savedIds, onSave, empty }) {
  const [all, setAll] = useState(false);
  if (list.length === 0) return <p className="empty">{empty}</p>;
  const shown = all ? list : list.slice(0, SHOW);
  return (
    <>
      <ul className="book-list">
        {shown.map((s) => <SpotRow key={s.id} spot={s} saved={savedIds.has(s.id)} onSave={onSave} />)}
      </ul>
      {list.length > SHOW && (
        <button type="button" className="btn btn-block" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? '접기' : `${list.length - SHOW}곳 더 보기`}
        </button>
      )}
    </>
  );
}

function Festivals({ pos, ...rest }) {
  const state = useFetch(() => fetchFestivals(pos, 30), [pos.lat, pos.lng]);
  return (
    <Body state={state} lines={4}>
      {(list) => (
        <>
          <p className="med-sub">30km 안 축제·행사 {list.length}곳{list.some((f) => f.ongoing) && <> · <b>{list.filter((f) => f.ongoing).length}곳 진행 중</b></>}</p>
          <SpotList list={list} empty="30km 안에 예정된 축제·행사가 없어요" {...rest} />
        </>
      )}
    </Body>
  );
}

function Spots({ pos, ...rest }) {
  const [kind, setKind] = useState('12');
  const state = useFetch(() => fetchSpots(pos, kind, 10000), [pos.lat, pos.lng, kind]);
  return (
    <>
      <div className="chips" role="tablist" aria-label="종류 고르기">
        {KINDS.map((k) => (
          <button key={k.id} type="button" role="tab" aria-selected={kind === k.id} className={`chip chip-sm${kind === k.id ? ' chip-on' : ''}`} onClick={() => setKind(k.id)}>{k.label}</button>
        ))}
      </div>
      <Body state={state} lines={4}>
        {(list) => <SpotList key={kind} list={list} empty="10km 안에서 찾지 못했어요" {...rest} />}
      </Body>
    </>
  );
}

export default function TourCard({ pos }) {
  const [tab, setTab] = useState(() => { try { const v = localStorage.getItem(TAB_KEY); return TABS.some((t) => t.id === v) ? v : 'fest'; } catch { return 'fest'; } });
  const [refresh, setRefresh] = useState(0);
  const [saved, setSaved] = useState(readList);
  useEffect(() => {
    const re = () => setSaved(readList());
    window.addEventListener('pd-data', re);
    return () => window.removeEventListener('pd-data', re);
  }, []);
  const pick = (id) => { setTab(id); try { localStorage.setItem(TAB_KEY, id); } catch { /* 괜찮음 */ } };
  const savedIds = new Set(saved.map((s) => s.id));
  const onSave = (s) => {
    const next = savedIds.has(s.id)
      ? saved.filter((x) => x.id !== s.id)
      : [{ id: s.id, type: s.type, title: s.title, addr: s.addr, tel: s.tel, image: s.image, lat: s.lat, lng: s.lng, start: s.start, end: s.end }, ...saved];
    setSaved(next);
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { /* 괜찮음 */ }
    markDirty();
  };
  const shared = { savedIds, onSave };
  // 저장한 곳은 지금 위치에서의 거리로, 끝난 행사는 맨 뒤로
  const today = todayYmd();
  const savedList = saved
    .map((s) => ({ ...s, distance: s.lat && s.lng ? Math.hypot((s.lat - pos.lat) * 111, (s.lng - pos.lng) * 88) : null }))
    .sort((a, b) => (Boolean(a.end && a.end < today) - Boolean(b.end && b.end < today)) || (a.distance ?? 1e9) - (b.distance ?? 1e9));

  return (
    <Card title="나들이" icon="🎡" onRefresh={() => setRefresh((n) => n + 1)}>
      <div className="chips" role="tablist" aria-label="나들이 보기 고르기">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`chip${tab === t.id ? ' chip-on' : ''}`} onClick={() => pick(t.id)}>
            {t.id === 'saved' && saved.length > 0 ? `${t.label} ${saved.length}` : t.label}
          </button>
        ))}
      </div>
      <div key={`${tab}${refresh}`}>
        {tab === 'fest' && <Festivals pos={pos} {...shared} />}
        {tab === 'spot' && <Spots pos={pos} {...shared} />}
        {tab === 'saved' && <SpotList list={savedList} empty="☆ 를 눌러 가 보고 싶은 곳을 담아 두세요. 계정에 저장돼 폰·PC 어디서나 보여요." {...shared} />}
      </div>
      <p className="card-foot">축제·관광 정보: 한국관광공사. 행사 일정은 바뀔 수 있으니 가기 전에 확인하세요.</p>
    </Card>
  );
}
