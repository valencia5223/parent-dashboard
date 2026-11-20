import { useState } from 'react';
import Card from './Card.jsx';
import BusSection from './BusSection.jsx';
import SubwaySection from './SubwaySection.jsx';

// 버스·지하철 한 카드: 탭으로 바꿔 보고, 고른 탭은 이 기기에 기억한다
const TABS = [
  { id: 'bus', label: '🚌 버스' },
  { id: 'subway', label: '🚇 지하철' },
];
const saved = () => { try { return localStorage.getItem('pd_transit'); } catch { return null; } };

export default function TransitCard({ pos }) {
  const [tab, setTab] = useState(() => (saved() === 'subway' ? 'subway' : 'bus'));
  const [refresh, setRefresh] = useState(0);
  const pick = (id) => { setTab(id); try { localStorage.setItem('pd_transit', id); } catch { /* 저장 못 해도 괜찮음 */ } };

  return (
    <Card title="버스·지하철" icon="🚏" onRefresh={() => setRefresh((n) => n + 1)}>
      <div className="seg" role="tablist" aria-label="버스·지하철 고르기">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => pick(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {/* 새로고침 버튼은 탭 내용을 다시 그려 정류장·역부터 새로 받는다 */}
      {tab === 'bus' ? <BusSection key={`b${refresh}`} pos={pos} /> : <SubwaySection key={`s${refresh}`} pos={pos} />}
    </Card>
  );
}
