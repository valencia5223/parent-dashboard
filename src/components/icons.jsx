import { useId } from 'react';

// 이모지로는 모양이 마음에 들지 않는 탭 아이콘을 직접 그린다.
// 다른 탭의 이모지(입체감 있는 그라데이션)와 어울리게 빛·그림자를 넣고, 글자 크기 1em 칸을 꽉 채운다.

// 도서관: 두툼하게 펼친 책 + 빨간 책갈피 끈
export function LibraryIcon({ className = '' }) {
  const id = useId().replace(/:/g, '');
  const g = (n) => `${id}-${n}`;
  return (
    <svg className={`svg-icon ${className}`} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={g('cover')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b9cff" />
          <stop offset="1" stopColor="#1f5fd8" />
        </linearGradient>
        <linearGradient id={g('left')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#e3e9f7" />
        </linearGradient>
        <linearGradient id={g('right')} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dfe6f6" />
        </linearGradient>
        <linearGradient id={g('edge')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#efe9ff" />
          <stop offset="1" stopColor="#c9bdf0" />
        </linearGradient>
        <linearGradient id={g('ribbon')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ff5a5a" />
          <stop offset="1" stopColor="#d92b3a" />
        </linearGradient>
      </defs>
      {/* 표지(뒤) */}
      <path d="M0.8 9.6C6 6.8 11.2 7.1 16 10.4c4.8-3.3 10-3.6 15.2-.8v18.2c-5.2-2.4-10.4-2.1-15.2 1.3-4.8-3.4-10-3.7-15.2-1.3z" fill={`url(#${g('cover')})`} />
      {/* 종이 두께(책장 옆면) */}
      <path d="M2.4 9.1C6.9 7 11.6 7.3 15.4 10v17.2c-3.8-2.6-8.5-2.9-13-1.1z" fill={`url(#${g('edge')})`} />
      <path d="M29.6 9.1C25.1 7 20.4 7.3 16.6 10v17.2c3.8-2.6 8.5-2.9 13-1.1z" fill={`url(#${g('edge')})`} />
      {/* 맨 위 쪽 */}
      <path d="M3 7.7c4.4-1.9 8.8-1.5 12.4 1.3v16.2c-3.6-2.6-8-3-12.4-1.3z" fill={`url(#${g('left')})`} />
      <path d="M29 7.7c-4.4-1.9-8.8-1.5-12.4 1.3v16.2c3.6-2.6 8-3 12.4-1.3z" fill={`url(#${g('right')})`} />
      {/* 글줄 */}
      <g stroke="#a9b8dc" strokeWidth="1.25" strokeLinecap="round" fill="none">
        <path d="M5.8 11.6c2.5-.7 5-.4 7.2.9" />
        <path d="M5.8 15c2.5-.7 5-.4 7.2.9" />
        <path d="M5.8 18.4c2.5-.7 5-.4 7.2.9" />
        <path d="M19 15.9c2.2-1.1 4.6-1.3 7.2-.6" />
        <path d="M19 19.3c2.2-1.1 4.6-1.3 7.2-.6" />
      </g>
      {/* 가운데 접힌 그늘 */}
      <path d="M15.4 9v16.5h1.2V9z" fill="#9fb0d8" opacity="0.7" />
      {/* 책갈피 끈 */}
      <path d="M20.7 3.2h4.4v10.6l-2.2-1.9-2.2 1.9z" fill={`url(#${g('ribbon')})`} />
      <path d="M20.7 3.2h1.2v9.6l-1.2 1z" fill="#ffffff" opacity="0.25" />
    </svg>
  );
}
