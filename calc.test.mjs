// 계산 코어 단위 테스트 — index.html에서 CALC_CORE 블록을 추출해 실행
// 실행: node calc.test.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');
const m = html.match(/\/\*==CALC_CORE_START==\*\/([\s\S]*?)\/\*==CALC_CORE_END==\*\//);
assert.ok(m, 'index.html에서 CALC_CORE 블록을 찾지 못함');

const exports_ = ['ymToIdx','idxToYm','ymShort','DEFAULT_RATES','loanSchedule','loanBalanceAt',
  'acqTaxRates','brokerageFee','stampDuty','bondCost','legalFee','acquisitionCosts',
  'capitalGainsTax','resolvedCosts','buildTimeline','fmtManwon','manFloor','fmtKR','giftTax'];
const dir = mkdtempSync(join(tmpdir(), 'cfc-'));
const modPath = join(dir, 'core.mjs');
writeFileSync(modPath, m[1] + '\nexport {' + exports_.join(',') + '};\n');
const C = await import(pathToFileURL(modPath).href);

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch(e){ failed++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}
const approx = (a, b, tol = 1) => assert.ok(Math.abs(a-b) <= tol, `${a} ≈ ${b} (±${tol}) 실패`);

console.log('\n[월 유틸]');
test('ymToIdx / idxToYm 왕복', () => {
  assert.equal(C.idxToYm(C.ymToIdx('2028-06')), '2028-06');
  assert.equal(C.ymToIdx('2028-10') - C.ymToIdx('2028-06'), 4);
  assert.equal(C.ymToIdx('2029-01') - C.ymToIdx('2028-12'), 1);
});

console.log('\n[대출 상환]');
test('원리금균등: 5억/4%/30년 → 월 약 2,387,076원', () => {
  const s = C.loanSchedule({principal:5e8, annualRate:4, years:30, type:'annuity'});
  assert.equal(s.length, 360);
  approx(s[0].interest + s[0].principal, 2387076, 5);
  approx(s[100].interest + s[100].principal, 2387076, 5); // 매월 동일
  approx(s[359].balance, 0, 1);
});
test('원금균등: 3억/5%/10년 → 첫달 원금 250만+이자 125만, 잔액 감소 일정', () => {
  const s = C.loanSchedule({principal:3e8, annualRate:5, years:10, type:'equal_principal'});
  approx(s[0].principal, 2500000, 1);
  approx(s[0].interest, 1250000, 1);
  approx(s[119].balance, 0, 1);
  assert.ok(s[0].interest + s[0].principal > s[60].interest + s[60].principal, '상환액이 줄어야 함');
});
test('만기일시: 이자만 내다 만기에 원금 전액', () => {
  const s = C.loanSchedule({principal:1e8, annualRate:6, years:2, type:'bullet'});
  approx(s[0].interest, 500000, 1);
  assert.equal(s[0].principal, 0);
  assert.equal(s[23].principal, 1e8);
  assert.equal(s[23].balance, 0);
});
test('거치기간: 거치 중 원금 0, 이후 상환', () => {
  const s = C.loanSchedule({principal:1e8, annualRate:4, years:10, graceMonths:12, type:'annuity'});
  assert.equal(s[5].principal, 0);
  assert.ok(s[12].principal > 0);
  approx(s[119].balance, 0, 1);
});
test('금리 0% 원리금균등 = 원금/개월수', () => {
  const s = C.loanSchedule({principal:1.2e8, annualRate:0, years:10, type:'annuity'});
  approx(s[0].principal, 1e6, 1);
  assert.equal(s[0].interest, 0);
});

test('변동금리: 5억/4%/30년, 13회차부터 6% → 상환액 재산정·만기 완제', () => {
  const s = C.loanSchedule({principal:5e8, annualRate:4, years:30, type:'annuity', rateChanges:[{k:13, rate:6}]});
  const p12 = s[11].interest + s[11].principal;   // 4% 구간
  const p13 = s[12].interest + s[12].principal;   // 6% 적용 첫 달
  approx(p12, 2387076, 5);
  assert.ok(p13 > p12 + 500000, '금리 인상 후 상환액 증가: ' + Math.round(p13));
  // 6%로 잔여 348개월 재산정한 이론값과 일치
  const bal12 = s[11].balance, i = 0.06/12;
  const A2 = bal12 * i / (1 - Math.pow(1+i, -348));
  approx(p13, A2, 5);
  approx(s[359].balance, 0, 1);
});
test('변동금리 만기일시: 금리 변경 후 이자만 변동', () => {
  const s = C.loanSchedule({principal:1e8, annualRate:3, years:2, type:'bullet', rateChanges:[{k:7, rate:5}]});
  approx(s[0].interest, 250000, 1);
  approx(s[6].interest, Math.round(1e8*0.05/12), 2);
  assert.equal(s[23].balance, 0);
});

console.log('\n[증여세]');
test('부모 1.5억 증여 → 공제 5천만, 과세표준 1억, 세액 970만(신고공제 3%)', () => {
  const r = C.giftTax(1.5e8, 'parent', C.DEFAULT_RATES);
  assert.equal(r.deduction, 5e7);
  assert.equal(r.taxable, 1e8);
  assert.equal(r.tax, C.manFloor(1e7 * 0.97)); // 9,700,000
});
test('배우자 5억 증여 → 공제 6억 이내 비과세', () => {
  assert.equal(C.giftTax(5e8, 'spouse', C.DEFAULT_RATES).tax, 0);
});
test('부모 3억 증여 → 과세표준 2.5억, 20% 구간 (누진공제 1천만)', () => {
  const r = C.giftTax(3e8, 'parent', C.DEFAULT_RATES);
  assert.equal(r.tax, C.manFloor((2.5e8*0.2 - 1e7) * 0.97)); // 38,800,000
});

console.log('\n[취득세]');
test('1주택 6억 이하 = 1% / 9억 초과 = 3%', () => {
  assert.equal(C.acqTaxRates({price:5e8, houses:1}).acq, 1);
  assert.equal(C.acqTaxRates({price:10e8, houses:1}).acq, 3);
});
test('1주택 7.5억 슬라이딩 = 2%', () => {
  approx(C.acqTaxRates({price:7.5e8, houses:1}).acq, 2, 0.01);
});
test('1주택 8억 슬라이딩 ≈ 2.33%', () => {
  approx(C.acqTaxRates({price:8e8, houses:1}).acq, 2.3333, 0.001);
});
test('조정 2주택 8% + 교육세 0.4% / 비조정 2주택은 슬라이딩', () => {
  const r = C.acqTaxRates({price:7e8, houses:2, adjusted:true});
  assert.equal(r.acq, 8); assert.equal(r.edu, 0.4);
  assert.ok(C.acqTaxRates({price:7e8, houses:2, adjusted:false}).acq < 3);
});
test('3주택 조정 12%, 85㎡초과 농특세 1.0%', () => {
  const r = C.acqTaxRates({price:7e8, houses:3, adjusted:true, over85:true});
  assert.equal(r.acq, 12); assert.equal(r.rural, 1.0);
});
test('85㎡ 이하 농특세 0', () => {
  assert.equal(C.acqTaxRates({price:7e8, houses:1, over85:false}).rural, 0);
});

console.log('\n[중개보수·인지세·채권·법무사]');
test('중개보수: 5억×0.4%=200만 / 10억×0.5%=500만 / 1.8억×0.5%=80만한도', () => {
  assert.equal(C.brokerageFee(5e8), 2000000);
  assert.equal(C.brokerageFee(10e8), 5000000);
  assert.equal(C.brokerageFee(1.8e8), 800000); // 한도 적용 (90만→80만)
});
test('인지세: 5억→15만 / 12억→35만', () => {
  assert.equal(C.stampDuty(5e8), 150000);
  assert.equal(C.stampDuty(12e8), 350000);
});
test('채권할인: 매매 7억(시가표준 70%=4.9억) → 2.6%×10% = 1,274,000', () => {
  assert.equal(C.bondCost(7e8, 70, 10), 1274000);
});
test('법무사 보수: 1억→26만 / 5억→60만', () => {
  assert.equal(C.legalFee(1e8), 260000);
  assert.equal(C.legalFee(5e8), 600000);
});

console.log('\n[취득 부대비용 통합]');
test('아파트 7억 / 1주택 / 85㎡이하: 취득세 1,166만 (만원 절사) 등', () => {
  const R = C.DEFAULT_RATES;
  const items = C.acquisitionCosts({price:7e8, houses:1, adjusted:false, over85:false, type:'apt'}, R);
  const get = k => items.find(i => i.key === k).amount;
  assert.equal(get('acq'), C.manFloor(7e8 * (7e8*2/3e8-3) / 100)); // 11,666,666 → 11,660,000
  assert.equal(get('acq') % 10000, 0, '만원 절사');
  assert.equal(get('rural'), 0);
  assert.equal(get('broker'), 2800000);
  assert.equal(get('stamp'), 150000);
});

console.log('\n[양도소득세]');
const R = C.DEFAULT_RATES;
test('1주택 2년 보유, 매도 10억 → 비과세 (12억 이하)', () => {
  const c = C.capitalGainsTax({sellPrice:10e8, buyPrice:7e8, expenses:2e7, holdMonths:30, liveMonths:0, houses:1, adjustedAtBuy:false}, R);
  assert.equal(c.total, 0);
  assert.ok(c.exempt);
});
test('조정지역 취득 1주택, 거주 안 함 → 비과세 불가', () => {
  const c = C.capitalGainsTax({sellPrice:10e8, buyPrice:7e8, expenses:0, holdMonths:30, liveMonths:0, houses:1, adjustedAtBuy:true}, R);
  assert.ok(!c.exempt);
  assert.ok(c.total > 0);
});
test('1년 미만 단기 70%: 차익 1억 → (1억-250만)×70% + 지방세 10% (만원 절사)', () => {
  const c = C.capitalGainsTax({sellPrice:8e8, buyPrice:7e8, expenses:0, holdMonths:10, houses:2}, R);
  const expected = C.manFloor((1e8 - 2500000) * 0.7);
  assert.equal(c.tax, expected);
  assert.equal(c.localTax, C.manFloor(expected * 0.1));
  assert.equal(c.total % 10000, 0, '만원 절사');
});
test('1~2년 단기 60%', () => {
  const c = C.capitalGainsTax({sellPrice:8e8, buyPrice:7e8, expenses:0, holdMonths:18, houses:2}, R);
  assert.equal(c.tax, C.manFloor((1e8 - 2500000) * 0.6));
});
test('일반 누진: 과표 5,000만 → 15% − 126만 = 624만', () => {
  // 차익 5,250만, 보유 2년(장특공 미달), 2주택 → 과표 5,000만
  const c = C.capitalGainsTax({sellPrice:7.525e8, buyPrice:7e8, expenses:0, holdMonths:30, houses:2}, R);
  approx(c.taxBase, 5e7, 1);
  assert.equal(c.tax, Math.round(5e7*0.15 - 1260000)); // 6,240,000
});
test('12억 초과 1주택 고가주택: 초과분 안분 + 장특공제(보유·거주 5년 = 40%)', () => {
  const c = C.capitalGainsTax({sellPrice:15e8, buyPrice:10e8, expenses:0, holdMonths:60, liveMonths:60, houses:1, adjustedAtBuy:true}, R);
  assert.ok(c.exempt);
  approx(c.taxableGain, 5e8 * (3/15) * (1 - 0.4), 1000); // 1억×0.6=6,000만
  assert.ok(c.total > 0);
});
test('양도차익 없으면 세금 0', () => {
  const c = C.capitalGainsTax({sellPrice:6e8, buyPrice:7e8, expenses:0, holdMonths:30, houses:1}, R);
  assert.equal(c.total, 0);
});
test('장특공제 일반: 10년 보유 → 20%', () => {
  const c = C.capitalGainsTax({sellPrice:9e8, buyPrice:7e8, expenses:0, holdMonths:120, houses:2}, R);
  assert.equal(c.ltsdRate, 20);
});

console.log('\n[표기]');
test('fmtKR: 만원 절사 억/만 표기', () => {
  assert.equal(C.fmtKR(325005326), '3억 2,500만원');
  assert.equal(C.fmtKR(300000000), '3억원');
  assert.equal(C.fmtKR(25000000), '2,500만원');
  assert.equal(C.fmtKR(-13000000), '-1,300만원');
  assert.equal(C.fmtKR(9999), '0원');
  assert.equal(C.fmtKR(0), '0원');
});
test('manFloor: 만원 미만 절사', () => {
  assert.equal(C.manFloor(18666667), 18660000);
  assert.equal(C.manFloor(-18666667), -18660000);
});

console.log('\n[통합 타임라인]');
function baseState(){
  return {
    flow: {
      startMonth:'2026-07', months:24, cashRate:0,
      holdings:[{cat:'예금', desc:'', amount:3e8}],
      monthly:[{cat:'급여', desc:'', amount:5e6}],
      inflows:[{month:'2027-01', desc:'상여', amount:1e7}],
      outflows:[{month:'2026-12', desc:'여행', amount:2e6}],
      gifts:[], borrowings:[]
    },
    buy: {
      type:'apt', over85:false, houses:1, adjusted:false, tenant:false, deposit:0,
      month:'2028-06', price:8e8,
      payments:[
        {month:'2028-06', desc:'선금', cash:2e8, loan:0},
        {month:'2028-10', desc:'잔금', cash:1e8, loan:5e8}
      ],
      loan:{type:'annuity', rate:4, years:30, grace:0, rateChanges:[]},
      costOverrides:{}, extraCosts:[], viewMonths:40
    },
    sell: {month:'2031-10', price:10e8, lived:false, liveMonths:0, depositMode:'assume', costOverrides:{}, extraCosts:[]},
    rates: JSON.parse(JSON.stringify(C.DEFAULT_RATES, (k,v) => v===Infinity?'INF':v), (k,v) => v==='INF'?Infinity:v)
  };
}
test('탭1: 첫 달 잔액 = 보유 3억 + 월 500만', () => {
  const tl = C.buildTimeline(baseState(), {includeBuy:false, includeSell:false, months:24});
  assert.equal(tl.rows[0].balance, 3e8 + 5e6);
  assert.equal(tl.rows[0].ym, '2026-07');
  // 2026-12: 유출 200만 반영
  const dec = tl.rows.find(r => r.ym === '2026-12');
  assert.equal(dec.outflow, 2e6);
});
test('탭2: 선금 달 현금 2억 유출, 잔금 달 대출 5억 실행·부대비용 유출', () => {
  const s = baseState();
  const tl = C.buildTimeline(s, {includeBuy:true, includeSell:false, months:40});
  const jun = tl.rows.find(r => r.ym === '2028-06');
  assert.ok(jun.events.some(e => e.amt === -2e8));
  const oct = tl.rows.find(r => r.ym === '2028-10');
  assert.ok(oct.events.some(e => e.amt === -1e8));
  assert.ok(oct.outflow > 1e8, '잔금 + 부대비용');
  assert.equal(oct.loanBal, 5e8, '잔금 달 대출잔액 5억');
  // 다음 달부터 원리금 상환 (약 238.7만)
  const nov = tl.rows.find(r => r.ym === '2028-11');
  const loanEv = nov.events.find(e => e.principal != null);
  approx(loanEv.amt, -2387076, 10);
  assert.ok(nov.loanBal < 5e8);
});
test('탭2: 세끼고 매수 시 잔금 달 보증금만큼 유입 상쇄', () => {
  const s = baseState();
  s.buy.tenant = true; s.buy.deposit = 2e8;
  s.buy.payments = [{month:'2028-06', desc:'선금', cash:1e8, loan:0}, {month:'2028-10', desc:'잔금', cash:0, loan:5e8}];
  const tl = C.buildTimeline(s, {includeBuy:true, includeSell:false, months:40});
  const oct = tl.rows.find(r => r.ym === '2028-10');
  assert.ok(oct.events.some(e => e.amt === 2e8 && /보증금/.test(e.label)));
});
test('탭3: 매도 달 이후 대출잔액 0, 상환 중단', () => {
  const s = baseState();
  const tl = C.buildTimeline(s, {includeBuy:true, includeSell:true, months:70});
  const sale = tl.rows.find(r => r.ym === '2031-10');
  assert.ok(sale.events.some(e => e.amt === 10e8), '매도 대금 유입');
  assert.equal(sale.loanBal, 0);
  const after = tl.rows.find(r => r.ym === '2031-11');
  assert.ok(!after.events.some(e => e.principal != null), '매도 후 상환 없음');
});
test('탭3: 중도상환 잔액 = 매도 전월까지 상환한 스케줄 잔액', () => {
  const s = baseState();
  const tl = C.buildTimeline(s, {includeBuy:true, includeSell:true, months:70});
  const sched = C.loanSchedule({principal:5e8, annualRate:4, years:30, graceMonths:0, type:'annuity'});
  // 대출 2028-10 실행, 매도 2031-10 → 상환 2028-11 ~ 2031-09 = 35회
  const paid = C.ymToIdx('2031-10') - C.ymToIdx('2028-10') - 1;
  assert.equal(paid, 35);
  approx(tl.sale.payoff, C.loanBalanceAt(sched, 5e8, 35), 1);
});
test('탭3: 실현손익 = 매도순수령 − 투입 − 원리금 납입', () => {
  const s = baseState();
  const tl = C.buildTimeline(s, {includeBuy:true, includeSell:true, months:70});
  const r = tl.realized;
  approx(r.profit, r.saleNet - r.invested - r.interestPaid - r.principalPaid, 1);
  assert.equal(r.invested, 3e8 + tl.costTotal);
});
test('탭3: 실현손익 = 타임라인상 부동산 관련 현금흐름 합과 일치 (교차 검증)', () => {
  const s = baseState();
  const tl = C.buildTimeline(s, {includeBuy:true, includeSell:true, months:70});
  let sum = 0;
  for(const row of tl.rows) for(const e of row.events) if(e.prop) sum += e.amt;
  approx(tl.realized.profit, sum, 2);
});
test('보증금 승계/반환: 실현손익 동일, 매도 달 이벤트 라벨만 다름', () => {
  const a = baseState(); a.buy.tenant = true; a.buy.deposit = 2e8;
  a.buy.payments = [{month:'2028-06', desc:'선금', cash:1e8, loan:0}, {month:'2028-10', desc:'잔금', cash:0, loan:5e8}];
  const b = JSON.parse(JSON.stringify(a)); b.sell.depositMode = 'return';
  b.rates = a.rates;
  const ta = C.buildTimeline(a, {includeBuy:true, includeSell:true, months:70});
  const tb = C.buildTimeline(b, {includeBuy:true, includeSell:true, months:70});
  approx(ta.realized.profit, tb.realized.profit, 1);
});
test('타임라인: 증여 유입 + 증여세 유출 (10년 합산 누적)', () => {
  const s = baseState();
  s.flow.gifts = [
    {month:'2026-08', rel:'parent', amount:1e8},
    {month:'2027-02', rel:'parent', amount:5e7}  // 누적 1.5억
  ];
  const tl = C.buildTimeline(s, {includeBuy:false, includeSell:false, months:24});
  const aug = tl.rows.find(r => r.ym === '2026-08');
  assert.ok(aug.events.some(e => e.amt === 1e8 && /증여 \(/.test(e.label)));
  const tax1 = C.giftTax(1e8, 'parent', s.rates).tax;   // 1차분
  assert.ok(aug.events.some(e => e.amt === -tax1 && /증여세/.test(e.label)));
  const feb = tl.rows.find(r => r.ym === '2027-02');
  const taxTotal = C.giftTax(1.5e8, 'parent', s.rates).tax;
  assert.ok(feb.events.some(e => e.amt === -(taxTotal - tax1)), '2차분은 누적세액-기납부');
});
test('타임라인: 차용 유입 → 매월 이자 → 만기 원금 상환', () => {
  const s = baseState();
  s.flow.borrowings = [{month:'2026-09', desc:'부모님', amount:2e8, rate:4.6, months:12}];
  const tl = C.buildTimeline(s, {includeBuy:false, includeSell:false, months:24});
  const sep = tl.rows.find(r => r.ym === '2026-09');
  assert.ok(sep.events.some(e => e.amt === 2e8 && /차용/.test(e.label)));
  const oct = tl.rows.find(r => r.ym === '2026-10');
  const int = C.manFloor(2e8 * 4.6 / 1200); // 76만
  assert.ok(oct.events.some(e => e.amt === -int && /차용 이자/.test(e.label)));
  const rep = tl.rows.find(r => r.ym === '2027-09'); // 12개월 후
  assert.ok(rep.events.some(e => e.amt === -2e8 && /원금 상환/.test(e.label)));
  const after = tl.rows.find(r => r.ym === '2027-10');
  assert.ok(!after.events.some(e => /차용 이자/.test(e.label)), '상환 후 이자 없음');
});
test('타임라인: 현금 보유 이자 (연 3%, 전월 양수 잔액 기준)', () => {
  const s = baseState();
  s.flow.cashRate = 3;
  const tl = C.buildTimeline(s, {includeBuy:false, includeSell:false, months:3});
  const m2 = tl.rows[1];
  const expected = C.manFloor(tl.rows[0].balance * 3 / 1200);
  const ev = m2.events.find(e => /현금 이자/.test(e.label));
  assert.equal(ev.amt, expected);
});
test('부대비용 오버라이드 반영', () => {
  const s = baseState();
  s.buy.costOverrides = {legal: 500000};
  s.buy.extraCosts = [{desc:'인테리어', amount:1e7}];
  const items = C.resolvedCosts(s.buy, s.rates);
  assert.equal(items.find(i => i.key === 'legal').amount, 500000);
  assert.ok(items.some(i => i.label === '인테리어' && i.amount === 1e7));
});

console.log(`\n결과: ${passed} 통과, ${failed} 실패`);
if(failed) process.exit(1);
