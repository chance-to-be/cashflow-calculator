// 데이터 파이프라인 공통 유틸 (의존성 0, Node 18+)
import fs from 'node:fs';
import path from 'node:path';

// ---------- 날짜 ----------
export function ymAdd(ym, n){ // 'YYYY-MM' + n개월
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
export function nowYm(d = new Date()){
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
// 최근 n개의 "완결된" 월 목록 (이번 달 제외), 과거→현재 순
export function recentMonths(n, today = new Date()){
  const cur = nowYm(today);
  const out = [];
  for(let i = n; i >= 1; i--) out.push(ymAdd(cur, -i));
  return out;
}
export function daysInMonth(ym){
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ---------- 통계 ----------
export function median(arr){
  if(!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
export function mean(arr){
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
export const round1 = v => Math.round(v * 10) / 10;

// ---------- XML ----------
// data.go.kr 응답용 초경량 파서: <item>…</item> 블록을 {태그: 값} 객체 배열로.
// CDATA·엔티티 최소 처리, 중첩 없는 평면 구조 전제 (RTMS 응답이 그렇다).
export function parseXmlItems(xml){
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while((m = itemRe.exec(xml))){
    const obj = {};
    const tagRe = /<([A-Za-z가-힣_][\w가-힣]*)>([\s\S]*?)<\/\1>/g;
    let t;
    while((t = tagRe.exec(m[1]))){
      let v = t[2].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
      v = v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      obj[t[1]] = v;
    }
    items.push(obj);
  }
  return items;
}
export function xmlTag(xml, tag){
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

// ---------- 실거래 레코드 정규화 ----------
// 신형(영문 태그)·구형(한글 태그) 응답 모두 지원. 해제거래는 null 반환.
export function normalizeTrade(item){
  if((item.cdealType || '').trim() === 'O') return null; // 계약 해제
  const amountRaw = item.dealAmount ?? item['거래금액'];
  const price = Number(String(amountRaw ?? '').replace(/[,\s]/g, '')); // 만원
  const area = Number(item.excluUseAr ?? item['전용면적']);             // ㎡
  const dong = (item.umdNm ?? item['법정동'] ?? '').trim();
  const apt = (item.aptNm ?? item['아파트'] ?? '').trim();
  const built = Number(item.buildYear ?? item['건축년도']) || null;
  if(!price || !area || !dong) return null;
  return { price, area, dong, apt, built };
}

// 전용면적 구간: s(<60㎡) / m(60~85㎡) / l(>85㎡)
export function areaBucket(area){
  if(area < 60) return 's';
  if(area <= 85) return 'm';
  return 'l';
}

// ---------- 지하철 승하차 레코드 정규화 ----------
// 서울열린데이터광장 CardSubwayStatsNew — 필드명 세대별 호환
export function normalizeSubwayRow(row){
  const line = (row.SBWY_ROUT_LN_NM ?? row.LINE_NUM ?? '').trim();
  const station = (row.STTN ?? row.SBWY_STNS_NM ?? row.SUB_STA_NM ?? '').trim();
  const ride = Number(row.GTON_TNOPE ?? row.RIDE_PASGR_NUM) || 0;
  const alight = Number(row.GTOFF_TNOPE ?? row.ALIGHT_PASGR_NUM) || 0;
  if(!station) return null;
  return { line, station: cleanStationName(station), ride, alight };
}
// '서울역(150)' → '서울', '강남(2호선)' → '강남' 등 부가 표기 제거
export function cleanStationName(name){
  return name.replace(/\(.*?\)/g, '').replace(/역$/, '').trim();
}

// ---------- HTTP ----------
export async function fetchText(url, {retries = 3, timeoutMs = 30000} = {}){
  let lastErr;
  for(let i = 0; i <= retries; i++){
    try{
      const res = await fetch(url, {signal: AbortSignal.timeout(timeoutMs)});
      if(!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    }catch(e){
      lastErr = e;
      if(i < retries) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

// ---------- 파일 ----------
export function readJson(file, fallback = null){
  try{ return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch{ return fallback; }
}
export function writeJson(file, obj){
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(obj));
}
export function dataDir(){
  return new URL('../data/', import.meta.url).pathname;
}
