// 데이터 파이프라인 단위 테스트
// 실행: node scripts/pipeline.test.mjs
import assert from 'node:assert/strict';
import {
  ymAdd, recentMonths, daysInMonth, median, parseXmlItems, xmlTag,
  normalizeTrade, areaBucket, normalizeSubwayRow, cleanStationName
} from './lib.mjs';
import {aggregateMonth} from './fetch_trades.mjs';
import {aggregateStations} from './fetch_subway.mjs';
import {heuristicMap} from './build_station_map.mjs';
import {mergeBuckets, buildSummary} from './build_summary.mjs';

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch(e){ failed++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}

console.log('\n[날짜·통계 유틸]');
test('ymAdd 월 경계·연 경계', () => {
  assert.equal(ymAdd('2026-01', -1), '2025-12');
  assert.equal(ymAdd('2026-11', 3), '2027-02');
});
test('recentMonths는 이번 달을 제외한 직전 n개월', () => {
  const m = recentMonths(3, new Date('2026-07-21T00:00:00Z'));
  assert.deepEqual(m, ['2026-04', '2026-05', '2026-06']);
});
test('daysInMonth 윤년', () => {
  assert.equal(daysInMonth('2024-02'), 29);
  assert.equal(daysInMonth('2026-02'), 28);
});
test('median 짝수·홀수', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
});

console.log('\n[실거래 XML 파싱]');
const XML_EN = `<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
<body><items>
<item><aptNm>래미안테스트</aptNm><buildYear>2010</buildYear><dealAmount>182,500</dealAmount>
<dealYear>2026</dealYear><dealMonth>6</dealMonth><excluUseAr>84.97</excluUseAr>
<umdNm>역삼동</umdNm><cdealType> </cdealType></item>
<item><aptNm>취소단지</aptNm><dealAmount>90,000</dealAmount><excluUseAr>59.9</excluUseAr>
<umdNm>역삼동</umdNm><cdealType>O</cdealType></item>
<item><aptNm>소형테스트</aptNm><dealAmount>95,000</dealAmount><excluUseAr>59.87</excluUseAr>
<umdNm>역삼동</umdNm></item>
</items><totalCount>3</totalCount></body></response>`;
test('영문 태그 파싱 + 해제거래 제외', () => {
  const items = parseXmlItems(XML_EN);
  assert.equal(items.length, 3);
  const trades = items.map(normalizeTrade).filter(Boolean);
  assert.equal(trades.length, 2); // 해제거래 1건 제외
  assert.equal(trades[0].price, 182500);
  assert.equal(trades[0].dong, '역삼동');
  assert.equal(trades[0].apt, '래미안테스트');
  assert.equal(trades[0].built, 2010);
});
test('구형 한글 태그도 지원', () => {
  const t = normalizeTrade({'거래금액': ' 82,000', '전용면적': '59.5', '법정동': ' 상계동', '아파트': '주공1'});
  assert.equal(t.price, 82000);
  assert.equal(t.dong, '상계동');
});
test('xmlTag totalCount / resultCode', () => {
  assert.equal(xmlTag(XML_EN, 'totalCount'), '3');
  assert.equal(xmlTag(XML_EN, 'resultCode'), '000');
});
test('areaBucket 경계값', () => {
  assert.equal(areaBucket(59.9), 's');
  assert.equal(areaBucket(60), 'm');
  assert.equal(areaBucket(85), 'm');
  assert.equal(areaBucket(85.1), 'l');
});

console.log('\n[실거래 월 집계]');
test('동·구간·단지별 집계와 중위값', () => {
  const rows = [
    {price: 100000, area: 84, dong: '역삼동', apt: 'A', built: 2010},
    {price: 120000, area: 84, dong: '역삼동', apt: 'A', built: 2010},
    {price: 60000, area: 50, dong: '역삼동', apt: 'B', built: 2000},
    {price: 50000, area: 84, dong: '대치동', apt: 'C', built: 1995}
  ];
  const agg = aggregateMonth(rows);
  assert.deepEqual(Object.keys(agg).sort(), ['대치동', '역삼동']);
  assert.equal(agg['역삼동'].buckets.m[0], 2);       // m구간 2건
  assert.equal(agg['역삼동'].buckets.m[1], 110000);  // 중위가
  assert.equal(agg['역삼동'].buckets.s[0], 1);
  assert.equal(agg['역삼동'].complexes.A[0], 2);
  assert.equal(agg['역삼동'].complexes.A[3], 2010);
});

console.log('\n[지하철 정규화·집계]');
test('신·구 필드명 모두 정규화', () => {
  const a = normalizeSubwayRow({SBWY_ROUT_LN_NM: '2호선', STTN: '강남', GTON_TNOPE: '50000', GTOFF_TNOPE: '48000'});
  assert.equal(a.station, '강남');
  assert.equal(a.ride, 50000);
  const b = normalizeSubwayRow({LINE_NUM: '2호선', SUB_STA_NM: '강남(강남역)', RIDE_PASGR_NUM: 1, ALIGHT_PASGR_NUM: 2});
  assert.equal(b.station, '강남');
});
test('역명 정리: 괄호·역 접미사 제거', () => {
  assert.equal(cleanStationName('서울역(150)'), '서울');
  assert.equal(cleanStationName('총신대입구(이수)'), '총신대입구');
});
test('일별 → 월 집계 (전체/평일 일평균)', () => {
  const daily = new Map([
    // 2026-06-01(월) ~ 06(토)
    ['20260601', [{line: '2호선', station: '강남', ride: 100, alight: 100}]],
    ['20260606', [{line: '2호선', station: '강남', ride: 40, alight: 40}]]
  ]);
  const agg = aggregateStations(daily);
  assert.equal(agg['강남'].avg, 140);   // (200+80)/2
  assert.equal(agg['강남'].avgWd, 200); // 평일은 6/1만
});

console.log('\n[역→동 매핑 휴리스틱]');
test('유일한 동 이름만 매핑, 중복은 거부', () => {
  const idx = new Map([
    ['역곡동', [{sido: '경기', sgg: '부천시'}]],
    ['중동', [{sido: '경기', sgg: '부천시'}, {sido: '인천', sgg: '중구'}]]
  ]);
  const hit = heuristicMap('역곡', idx);
  assert.equal(hit.dong, '역곡동');
  assert.equal(hit.src, 'name');
  assert.equal(heuristicMap('중동', idx), null); // 중복 → 매핑 안 함
});

console.log('\n[요약 빌드]');
test('mergeBuckets 거래량 가중 병합', () => {
  const m = mergeBuckets([[1, 100000, 5000, 84], [3, 120000, 6000, 84]]);
  assert.equal(m[0], 4);
  assert.equal(m[1], 115000);
  assert.equal(m[2], 5750);
});
test('buildSummary: 최근 3개월 통계·전년비·역 승하차 결합', () => {
  const months = recentMonths(36, new Date('2026-07-21T00:00:00Z'));
  const mk = (n, med, py) => ({buckets: {m: [n, med, py, 84]}, complexes: {}});
  const priceMonths = {};
  priceMonths[months[35]] = {'역삼동': mk(4, 180000, 7200)};  // 최근
  priceMonths[months[23]] = {'역삼동': mk(4, 160000, 6400)};  // 12개월 전 (전년 3개월 창)
  const rows = buildSummary({
    regions: [{code: '11680', sido: '서울', name: '강남구'}],
    priceFiles: {'11680': {code: '11680', sido: '서울', name: '강남구', months: priceMonths}},
    ridership: {stations: {'강남': {months: {[months[35]]: [150000, 190000]}}}},
    stationDong: {stations: {'강남': {sido: '서울', sgg: '강남구', dong: '역삼동'}}},
    months
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dong, '역삼동');
  assert.equal(rows[0].b.m[1], 180000);
  assert.equal(rows[0].yoy.m, 12.5);      // 7200/6400 - 1
  assert.equal(rows[0].ride, 190000);     // 평일 일평균
  assert.deepEqual(rows[0].st, ['강남']);
  assert.equal(rows[0].vol12, 4);
});

console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
process.exit(failed ? 1 : 0);
