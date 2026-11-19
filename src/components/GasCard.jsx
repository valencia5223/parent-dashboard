import { useEffect, useState } from 'react';
import { fetchGas, useFetch } from '../api.js';
import { markDirty } from '../account.js';
import Card, { Body } from './Card.jsx';

const FUELS = [
  { id: 'gasoline', label: '휘발유' },
  { id: 'diesel', label: '경유' },
  { id: 'lpg', label: 'LPG' },
  { id: 'premium', label: '고급휘발유' },
];
const RADII = [3000, 5000];
const won = (v) => `${v.toLocaleString('ko-KR')}원`;
const km = (m) => (m == null ? '' : m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`);
const saved = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 괜찮음 */ } markDirty(); };

const GAS_SHOW = 4; // 처음에 보여 줄 주유소 수

export default function GasCard({ pos }) {
  const [fuel, setFuel] = useState(() => saved('pd_fuel', 'gasoline'));
  const [more, setMore] = useState(false);
  const [radius, setRadius] = useState(() => Number(saved('pd_radius', '3000')));
  // 계정에서 받은 설정으로 바뀌면 다시 읽는다
  useEffect(() => {
    const re = () => { setFuel(saved('pd_fuel', 'gasoline')); setRadius(Number(saved('pd_radius', '3000'))); };
    window.addEventListener('pd-data', re);
    return () => window.removeEventListener('pd-data', re);
  }, []);
  const state = useFetch(() => fetchGas(pos, fuel, radius), [pos.lat, pos.lng, fuel, radius], { interval: 30 * 60e3 });

  const pickFuel = (id) => { setFuel(id); save('pd_fuel', id); };
  const pickRadius = (r) => { setRadius(r); save('pd_radius', String(r)); };

  return (
    <Card
      title="싼 주유소"
      icon="⛽"
      state={state}
      onRefresh={state.reload}
      actions={RADII.map((r) => (
        <button key={r} type="button" className={`chip chip-sm${radius === r ? ' chip-on' : ''}`} onClick={() => pickRadius(r)} aria-pressed={radius === r} aria-label={`반경 ${r / 1000}km`}>
          {r / 1000}km
        </button>
      ))}
    >
      {/* 유종 4개가 핸드폰 한 줄에 안 들어가면 옆으로 밀어 본다 */}
      <div className="chips chips-scroll">
        {FUELS.map((f) => (
          <button key={f.id} type="button" className={`chip${fuel === f.id ? ' chip-on' : ''}`} onClick={() => pickFuel(f.id)} aria-pressed={fuel === f.id}>
            {f.label}
          </button>
        ))}
      </div>
      <Body state={state} lines={5}>
        {(list) => {
          if (list.length === 0) {
            return (
              <div className="empty">
                <p>{radius / 1000}km 안에서 주유소를 찾지 못했어요.</p>
                {/* 오피넷은 키가 틀려도 오류 대신 빈 목록을 준다 */}
                <small>도시 안인데도 계속 비어 있으면 오피넷 키가 아직 승인 전이거나 잘못된 것일 수 있어요.</small>
              </div>
            );
          }
          const top = list.slice(0, 6);
          const shown = more ? top : top.slice(0, GAS_SHOW);
          const avg = Math.round(list.reduce((s, o) => s + o.price, 0) / list.length);
          return (
            <>
              <ol className="gas-list">
                {shown.map((o, i) => (
                  <li key={o.id}>
                    <span className="gas-rank">{i + 1}</span>
                    <span className="gas-name">
                      {o.name}
                      <small>{o.brand} · {km(o.distance)}</small>
                    </span>
                    <span className="gas-price">{won(o.price)}</span>
                    <a className="btn btn-sm" href={`https://map.kakao.com/link/to/${encodeURIComponent(o.name)},${o.lat},${o.lng}`} target="_blank" rel="noreferrer">
                      길찾기
                    </a>
                  </li>
                ))}
              </ol>
              {top.length > GAS_SHOW && (
                <button type="button" className="btn btn-sm btn-block" onClick={() => setMore(!more)} aria-expanded={more}>
                  {more ? '접기' : `${top.length - GAS_SHOW}곳 더 보기`}
                </button>
              )}
              <p className="card-foot">
                주변 {list.length}곳 평균 {won(avg)} · 1등이 평균보다 {won(avg - top[0].price)} 싸요 (50L면 {won((avg - top[0].price) * 50)})
              </p>
            </>
          );
        }}
      </Body>
      <p className="card-foot">가격 정보: 오피넷(한국석유공사)</p>
    </Card>
  );
}
