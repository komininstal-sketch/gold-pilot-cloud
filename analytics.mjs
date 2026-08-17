import fs from 'node:fs/promises';

const OUT_DIR=process.env.OUT_DIR||'/tmp/gold-pilot-out';
const PREV_ANALYTICS=process.env.PREV_ANALYTICS||'/tmp/gold-pilot-prev-analytics.json';
const PREV_TIMELINE=process.env.PREV_TIMELINE||'/tmp/gold-pilot-prev-timeline.json';
const UA='Mozilla/5.0 (GoldPilotCloud/1.1; +https://github.com/komininstal-sketch/gold-pilot-cloud)';
const now=Date.now(), iso=new Date(now).toISOString();

function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x));}
function n(v){if(v===null||v===undefined||v==='')return null;if(typeof v==='number')return Number.isFinite(v)?v:null;let s=String(v).trim().replace(/\u00a0/g,' ').replace(/[’']/g,'').replace(/\s+/g,'');if(!s)return null;const ci=s.lastIndexOf(','),di=s.lastIndexOf('.');if(ci>=0&&di>=0)s=di>ci?s.replace(/,/g,''):s.replace(/\./g,'').replace(',','.');else if(ci>=0)s=(s.length-ci-1<=4)?s.replace(',','.'):s.replace(/,/g,'');const x=Number(s.replace(/[^0-9eE+\-.]/g,''));return Number.isFinite(x)?x:null;}
function strip(s=''){return String(s).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();}
function hash(s=''){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
function eventKey(x){return hash([x.kind,x.title,x.url,x.ts].join('|').toLowerCase());}
async function readJson(path,fallback=null){try{return JSON.parse(await fs.readFile(path,'utf8'));}catch{return fallback;}}
async function fetchText(url,timeout=11000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{headers:{'user-agent':UA,'accept-language':'en-US,en;q=0.9,pl;q=0.8'},signal:c.signal,redirect:'follow'});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.text();}finally{clearTimeout(t);}}
async function fetchJson(url,timeout=11000){return JSON.parse(await fetchText(url,timeout));}
async function reader(url){try{return await fetchText('https://r.jina.ai/'+url,14000);}catch{return await fetchText(url,12000);}}
function ageMin(stamp){if(!stamp)return Infinity;const d=new Date(stamp);return isNaN(d)?Infinity:(now-d.getTime())/60000;}
function due(prev,name,mins){return ageMin(prev?.modules?.[name]?.fetchedAt)>mins;}
function moduleWrap(data,prev,name,fetched=true,error=null){return {data:data??prev?.modules?.[name]?.data??null,fetchedAt:fetched?iso:(prev?.modules?.[name]?.fetchedAt||null),error:error||null};}

const latest=await readJson(`${OUT_DIR}/latest.json`,{});
const prev=await readJson(PREV_ANALYTICS,{schema:2,modules:{},snapshot:null});
const prevTimeline=await readJson(PREV_TIMELINE,{schema:1,events:[]});
const market=latest?.point?.market||{};
const dealers=latest?.point?.dealers||{};

async function fredLast(id){const txt=await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`);const lines=txt.trim().split(/\r?\n/);for(let i=lines.length-1;i>=1;i--){const [date,val]=lines[i].split(',');const v=n(val);if(v!==null)return {id,date,value:v};}throw new Error('FRED '+id+' empty');}
function scoreReal(v){return v<=1?82:v<=1.5?68:v<=2?55:v<=2.5?42:28;}
function scoreDollar(v,prevv){if(!(v>0)||!(prevv>0))return 50;const p=(v/prevv-1)*100;return clamp(50-p*14,20,80);}
function scoreFed2y(v,prevv){if(!(v>0)||!(prevv>0))return 50;const bp=(v-prevv)*100;return clamp(50-bp*1.2,20,82);}
function scoreVix(v){return v>=35?80:v>=25?68:v>=18?56:v>=13?48:40;}
function scoreInfl(v){return v>=3?70:v>=2.4?60:v>=1.8?52:45;}
function scoreUnc(v,prevv){if(!(v>0))return 50;if(!(prevv>0))return 50;const p=(v/prevv-1)*100;return clamp(50+p*4,30,75);}
async function getMacro(){const ids=['DFII10','DTWEXBGS','DGS2','VIXCLS','T10YIE','GEPUCURRENT','DFEDTARU','DFEDTARL'];const rows={};for(const id of ids){try{rows[id]=await fredLast(id);}catch{rows[id]=null;}}const old=prev?.modules?.macro?.data||{};return {rows,scores:{realYield:rows.DFII10?scoreReal(rows.DFII10.value):50,dollar:rows.DTWEXBGS?scoreDollar(rows.DTWEXBGS.value,old?.rows?.DTWEXBGS?.value):50,fed2y:rows.DGS2?scoreFed2y(rows.DGS2.value,old?.rows?.DGS2?.value):50,vix:rows.VIXCLS?scoreVix(rows.VIXCLS.value):50,inflation:rows.T10YIE?scoreInfl(rows.T10YIE.value):50,uncertainty:rows.GEPUCURRENT?scoreUnc(rows.GEPUCURRENT.value,old?.rows?.GEPUCURRENT?.value):50}};}

const eventsFallback=[
 ['FOMC','2026-09-16T18:00:00Z','FOMC • decyzja o stopach i komunikat',3,'Federal Reserve'],['FOMC','2026-10-28T18:00:00Z','FOMC • decyzja o stopach i komunikat',3,'Federal Reserve'],['FOMC','2026-12-09T19:00:00Z','FOMC • decyzja o stopach i komunikat',3,'Federal Reserve'],
 ['NFP','2026-09-04T12:30:00Z','USA • raport z rynku pracy',3,'BLS'],['NFP','2026-10-02T12:30:00Z','USA • raport z rynku pracy',3,'BLS'],['NFP','2026-11-06T13:30:00Z','USA • raport z rynku pracy',3,'BLS'],['NFP','2026-12-04T13:30:00Z','USA • raport z rynku pracy',3,'BLS'],
 ['CPI','2026-09-11T12:30:00Z','USA • inflacja CPI',3,'BLS'],['CPI','2026-10-14T12:30:00Z','USA • inflacja CPI',3,'BLS'],['CPI','2026-11-13T13:30:00Z','USA • inflacja CPI',3,'BLS'],['CPI','2026-12-10T13:30:00Z','USA • inflacja CPI',3,'BLS'],
 ['RPP','2026-09-02T08:00:00Z','Polska • RPP / decyzja o stopach',3,'NBP'],['RPP','2026-10-07T08:00:00Z','Polska • RPP / decyzja o stopach',3,'NBP'],['RPP','2026-11-04T09:00:00Z','Polska • RPP / decyzja o stopach',3,'NBP'],['RPP','2026-12-02T09:00:00Z','Polska • RPP / decyzja o stopach',3,'NBP']
].map(x=>({type:x[0],ts:new Date(x[1]).getTime(),title:x[2],importance:x[3],source:x[4]}));
function getEvents(){const up=eventsFallback.filter(e=>e.ts>now-3600000).sort((a,b)=>a.ts-b.ts);const next=up.find(e=>e.ts>now)||up[0]||null;let riskScore=92,blocking=false;if(next){const h=(next.ts-now)/3600000;if(next.importance>=3&&h>=0&&h<=1){riskScore=15;blocking=true;}else if(next.importance>=3&&h<=3)riskScore=28;else if(next.importance>=3&&h<=12)riskScore=45;else if(next.importance>=3&&h<=24)riskScore=60;else if(h<=72)riskScore=78;}return {next,upcoming:up.slice(0,8),riskScore,blocking};}

function parseCsvLine(line){const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(c===','&&!q){out.push(cur.trim());cur='';}else cur+=c;}out.push(cur.trim());return out;}
function parseCot(text){const line=String(text).split(/\r?\n/).find(x=>/^"?GOLD - COMMODITY EXCHANGE INC\./i.test(x.trim()));if(!line)return null;const f=parseCsvLine(line),v=i=>n(f[i]);const ml=v(13),ms=v(14),cl=v(61),cs=v(62);return {reportDate:f[2]||null,openInterest:v(7),oiChange:v(55),managedLong:ml,managedShort:ms,managedNet:ml!==null&&ms!==null?ml-ms:null,managedNetChange:cl!==null&&cs!==null?cl-cs:null};}
function parseWgc(text){const p=String(text).replace(/\s+/g,' ');let flowBn=null,holdingsT=null;let m=p.match(/(?:net\s+)?(inflows?|outflows?)[^$]{0,100}?US\$\s*([0-9.]+)\s*bn/i);if(m)flowBn=Number(m[2])*(/outflow/i.test(m[1])?-1:1);m=p.match(/holdings[^.]{0,120}?(?:to|at)\s*([0-9,]+)\s*t/i);if(m)holdingsT=Number(m[1].replace(/,/g,''));return {flowBn,holdingsT};}
async function getFlows(){const [cot,wgc]=await Promise.allSettled([fetchText('https://www.cftc.gov/dea/newcot/f_disagg.txt'),reader('https://www.gold.org/goldhub/data/gold-etfs-holdings-and-flows')]);const c=cot.status==='fulfilled'?parseCot(cot.value):null,e=wgc.status==='fulfilled'?parseWgc(wgc.value):{};let cs=50,es=50;if(c?.managedNetChange!==null)cs=clamp(50+c.managedNetChange/1800,25,80);if(e?.flowBn!==null)es=clamp(50+e.flowBn*3.5,25,82);return {cot:c,etf:e,score:Math.round(cs*.6+es*.4)};}

async function getCvol(){try{const t=(await reader('https://www.cmegroup.com/markets/metals/precious/gold.quotes.options.html')).replace(/\s+/g,' ');let m=t.match(/Gold CVOL Index[\s\S]{0,500}?Cvol:\s*([0-9]+(?:\.[0-9]+)?)/i);if(!m)m=t.match(/\bGCVL\b[\s\S]{0,300}?([0-9]{1,3}(?:\.[0-9]+)?)/i);const value=m?Number(m[1]):null;return {value:value>0&&value<200?value:null};}catch{return {value:null};}}
function expectedMove(cvol){const v=n(cvol);if(!(v>0))return {daily:null,weekly:null};return {daily:v/Math.sqrt(252),weekly:v*Math.sqrt(5/252)};}

function impact(title){const t=String(title||'');let g=0,u=0,p=0,cat='Informacja',confidence=45,mech='Brak jednoznacznego wpływu.';const hawk=/(rate hike|higher for longer|hawkish|not ready to cut|inflation remains elevated|restrictive policy)/i.test(t),dove=/(rate cut|dovish|easing|ready to cut|lower rates|disinflation)/i.test(t),war=/(missile|airstrike|drone strike|invasion|military escalation|attack on|war\b)/i.test(t),peace=/(ceasefire|truce|peace deal|de-escalat|peace talks)/i.test(t),tariff=/(tariff|sanction)/i.test(t),weak=/(recession|weak jobs|unemployment rises|economic slowdown|contraction)/i.test(t),strong=/(strong jobs|robust growth|stronger-than-expected|economic expansion)/i.test(t);if(hawk){g=-2.4;u=2.7;p=2.2;cat='Fed • jastrzębio';confidence=88;mech='Wyższe stopy zwykle wspierają USD i ciążą złotu.';}else if(dove){g=2.6;u=-2.6;p=-2;cat='Fed • gołębio';confidence=88;mech='Łagodniejszy Fed zwykle wspiera złoto i osłabia USD.';}else if(war){g=2.8;u=1.1;p=1.6;cat='Eskalacja geopolityczna';confidence=78;mech='Risk-off zwykle wspiera złoto, a PLN może słabnąć.';}else if(peace){g=-2.5;u=-.5;p=-.8;cat='Deeskalacja';confidence=74;mech='Spadek premii za ryzyko może obciążać złoto.';}else if(tariff){g=1.2;u=.4;p=.6;cat='Cła / sankcje';confidence=58;mech='Wyższa niepewność może wspierać złoto.';}else if(weak){g=1.5;u=-1.4;p=-1;cat='Słabsze dane USA';confidence=66;mech='Słabsze dane mogą zwiększać oczekiwania na łagodniejszy Fed.';}else if(strong){g=-1.3;u=1.6;p=1.2;cat='Mocne dane USA';confidence=68;mech='Mocne dane mogą wspierać rentowności i USD.';}return {relevance:Math.max(Math.abs(g),Math.abs(u),Math.abs(p))>.3,category:cat,confidence,goldImpact:g,usdImpact:u,usdPlnImpact:p,mechanism:mech};}
async function gdelt(q,max=30,span='18h'){const u='https://api.gdeltproject.org/api/v2/doc/doc?query='+encodeURIComponent(q)+`&mode=artlist&format=json&maxrecords=${max}&timespan=${span}&sort=datedesc`;try{const j=await fetchJson(u,14000);return (j?.articles||[]).map(a=>({title:a.title||'',url:a.url||'',domain:a.domain||'',seen:a.seendate||''}));}catch{return [];}}
function seenTs(v){if(!v)return now;const s=String(v),m=s.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})?/);if(m)return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]||'00'}Z`).getTime();const d=new Date(v);return isNaN(d)?now:d.getTime();}
async function getPolitics(){const kw='(gold OR dollar OR fed OR tariff OR sanctions OR war OR ceasefire OR inflation OR rates OR Poland OR zloty)';const [r,a,o]=await Promise.all([gdelt('domainis:reuters.com '+kw,35,'20h'),gdelt('domainis:apnews.com '+kw,25,'20h'),gdelt('(domainis:whitehouse.gov OR domainis:federalreserve.gov OR domainis:home.treasury.gov OR domainis:nato.int OR domainis:prezydent.pl) '+kw,35,'48h')]);const raw=[...r.map(x=>({...x,tier:'VERIFIED WIRE',sourceName:'Reuters'})),...a.map(x=>({...x,tier:'VERIFIED WIRE',sourceName:'AP'})),...o.map(x=>({...x,tier:'OFFICIAL',sourceName:x.domain}))];const seen=new Set(),items=[];for(const x of raw){const k=hash(x.title.toLowerCase().replace(/[^a-z0-9]+/g,' '));if(seen.has(k))continue;seen.add(k);const im=impact(x.title);if(im.relevance)items.push({...x,...im,ts:seenTs(x.seen)});}items.sort((a,b)=>b.ts-a.ts);const top=items.slice(0,14);let gs=50,us=50,ps=50;if(top.length){const avg=k=>top.slice(0,8).reduce((s,x)=>s+(n(x[k])||0),0)/Math.max(1,top.slice(0,8).length);gs=clamp(50+avg('goldImpact')*13,10,90);us=clamp(50+avg('usdImpact')*13,10,90);ps=clamp(50+avg('usdPlnImpact')*13,10,90);}return {goldScore:Math.round(gs),usdScore:Math.round(us),usdPlnScore:Math.round(ps),count:top.length,items:top};}

const OUTLOOK=[['WGC','gold','https://www.gold.org/goldhub/research/library',.75,1.35],['ING','gold','https://think.ing.com/market/commodities/',1.1,1.35],['SAXO','gold','https://www.home.saxo/en-gb/insights/news-and-research/commodities',1.15,1],['REUTERS','gold','https://www.reuters.com/markets/gold/',1.35,.8],['ING','fx','https://think.ing.com/market/fx/',1.2,1.35],['SAXO','fx','https://www.home.saxo/en-gb/insights/news-and-research/forex',1.1,1],['REUTERS','fx','https://www.reuters.com/markets/currencies/',1.35,.8]];
function sig(text){const t=String(text);let g=0,u=0,p=0;const reasons=[];const hit=r=>r.test(t);if(hit(/weaker .*dollar|dollar .*falls|usd .*weak/i)){g+=1.5;u-=1.7;p-=1.1;reasons.push('słabszy USD');}if(hit(/stronger .*dollar|dollar .*rises|usd .*strength/i)){g-=1.5;u+=1.7;p+=1.1;reasons.push('mocniejszy USD');}if(hit(/rate cut|dovish|lower yields|easing/i)){g+=1.4;u-=1.3;p-=.8;reasons.push('łagodniejsze stopy');}if(hit(/rate hike|hawkish|higher yields|higher for longer/i)){g-=1.4;u+=1.3;p+=.8;reasons.push('wyższe stopy');}if(hit(/central bank .*gold|official sector buying|etf inflow|investment demand/i)){g+=1.2;reasons.push('popyt inwestycyjny');}if(hit(/geopolitical tension|war|safe[- ]haven|uncertainty/i)){g+=.6;u+=.3;p+=.3;}if(hit(/ceasefire|peace deal|de-escalation/i)){g-=.5;p-=.2;}return {gold:clamp(g,-3.5,3.5),usd:clamp(u,-3.5,3.5),usdpln:clamp(p,-3.5,3.5),reasons:[...new Set(reasons)]};}
function headings(md){return String(md).split(/\r?\n/).filter(x=>/^#{2,5}\s+/.test(x)).map(x=>x.replace(/^#{2,5}\s+/,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').trim()).filter(x=>x.length>=15&&x.length<220).slice(0,5);}
async function getOutlook(){const items=[];for(const [org,focus,url,sw,mw] of OUTLOOK){try{const md=await reader(url);const hs=headings(md);for(const title of hs.slice(0,2)){const s=sig(title);if(Math.max(Math.abs(s.gold),Math.abs(s.usd),Math.abs(s.usdpln))>.2)items.push({org,focus,url,title,...s,shortWeight:sw,mediumWeight:mw});}}catch{}}const families=[...new Set(items.map(x=>x.org))];let wg=0,wu=0,wp=0,w=0;for(const x of items){wg+=x.gold*x.shortWeight;wu+=x.usd*x.shortWeight;wp+=x.usdpln*x.shortWeight;w+=x.shortWeight;}const g=w?wg/w:0,u=w?wu/w:0,p=w?wp/w:0;const pln=g+p*.7;const score=clamp(50+pln*11,18,85);const agreement=clamp(35+families.length*10-Math.min(25,Math.abs(g-u)*4),30,90);return {items:items.slice(0,14),families,sourceCount:families.length,goldSignal:g,usdSignal:u,usdPlnSignal:p,plnGoldSignal:pln,score:Math.round(score),agreement:Math.round(agreement),direction:pln>.45?'WZROSTOWO':pln<-.45?'SPADKOWO':'NEUTRALNIE'};}

const INST=[['J.P. Morgan',6000,'XII 2026','BULLISH / WARUNKOWO'],['UBS CIO',5000,'H1 2027','BULLISH'],['Citi',5000,'2027','NEUTRALNIE → BULLISH'],['Goldman Sachs',4900,'XII 2026','BULLISH']];
function institutions(xau,usdpln){const rows=INST.map(([name,target,horizon,stance])=>({name,target,horizon,stance,upside:xau>0?(target/xau-1)*100:null,plnG:xau>0&&usdpln>0?target*usdpln/31.1034768:null}));const avg=rows.reduce((s,x)=>s+x.target,0)/rows.length;const up=xau>0?(avg/xau-1)*100:0;return {rows,avgTarget:avg,upside:up,score:Math.round(clamp(50+up*1.1,25,92))};}

async function getPoland(){let nbpUsd=null;try{const j=await fetchJson('https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json');nbpUsd=n(j?.rates?.[0]?.mid);}catch{}return {nbpUsd,liveUsdPln:n(market.usdPln),nbpGold:n(market.nbpGoldPlnG),liveGoldPlnG:n(market.plnG),usdDiffPct:nbpUsd>0&&market.usdPln>0?(market.usdPln/nbpUsd-1)*100:null};}

async function buildModule(name,mins,fn){if(!due(prev,name,mins))return moduleWrap(null,prev,name,false);try{return moduleWrap(await fn(),prev,name,true);}catch(e){return moduleWrap(null,prev,name,false,String(e?.message||e));}}

const modules={};
modules.macro=await buildModule('macro',55,getMacro);
modules.events=await buildModule('events',240,async()=>getEvents());
modules.flows=await buildModule('flows',330,getFlows);
modules.cvol=await buildModule('cvol',25,getCvol);
modules.politics=await buildModule('politics',12,getPolitics);
modules.outlook=await buildModule('outlook',25,getOutlook);
modules.institutions=moduleWrap(institutions(n(market.xauUsd),n(market.usdPln)),prev,'institutions',true);
modules.poland=await buildModule('poland',12,getPoland);

const macro=modules.macro.data||{}, evt=modules.events.data||getEvents(), flows=modules.flows.data||{}, cvol=modules.cvol.data||{}, politics=modules.politics.data||{}, outlook=modules.outlook.data||{}, inst=modules.institutions.data||{};
const move=expectedMove(cvol.value);
const vol={cvol:n(cvol.value),dailyMovePct:move.daily,weeklyMovePct:move.weekly,lowPlnG:move.daily!==null&&market.plnG>0?market.plnG*(1-move.daily/100):null,highPlnG:move.daily!==null&&market.plnG>0?market.plnG*(1+move.daily/100):null};
const macroScores=macro?.scores||{};
const publicOutlook=Math.round(clamp((macroScores.realYield||50)*.16+(macroScores.dollar||50)*.11+(macroScores.fed2y||50)*.11+(macroScores.vix||50)*.08+(macroScores.inflation||50)*.07+(macroScores.uncertainty||50)*.03+(politics.goldScore||50)*.14+(outlook.score||50)*.15+(flows.score||50)*.07+(inst.score||50)*.08,10,90));
const dealerValues=Object.fromEntries(Object.entries(dealers||{}).map(([k,v])=>[k,n(v?.salePln)]));
const snapshot={ts:now,iso,market,dealers:dealerValues,macro,events:evt,flows,cvol:vol,politics,outlook,institutions:inst,poland:modules.poland.data||{},publicOutlookScore:publicOutlook};

const changes=[];
function add(kind,title,detail='',importance=2,url=''){changes.push({kind,title,detail,importance,url,ts:now});}
const ps=prev?.snapshot;
if(ps){const pct=(a,b)=>a>0&&b>0?(a/b-1)*100:null;const pg=pct(n(market.plnG),n(ps?.market?.plnG));if(pg!==null&&Math.abs(pg)>=.25)add('price',`Złoto PLN/g ${pg>0?'wzrosło':'spadło'} ${Math.abs(pg).toFixed(2)}%`,'od poprzedniego zapisu chmurowego',Math.abs(pg)>=.8?3:2);const fx=pct(n(market.usdPln),n(ps?.market?.usdPln));if(fx!==null&&Math.abs(fx)>=.15)add('fx',`USD/PLN ${fx>0?'wzrósł':'spadł'} ${Math.abs(fx).toFixed(2)}%`,'wpływa na polską cenę złota',Math.abs(fx)>=.5?3:2);for(const [id,v] of Object.entries(dealerValues)){const old=n(ps?.dealers?.[id]);if(v>0&&old>0&&Math.abs(v-old)>=8)add('dealer',`${id.toUpperCase()}: cena 10 g ${v>old?'wzrosła':'spadła'} o ${Math.abs(v-old).toFixed(0)} zł`,`${old.toFixed(0)} → ${v.toFixed(0)} zł`,Math.abs(v-old)>=25?3:2);}if(Math.abs(publicOutlook-(n(ps.publicOutlookScore)||50))>=5)add('outlook',`Perspektywa rynku zmieniła się: ${ps.publicOutlookScore} → ${publicOutlook}/100`,'zmiana zestawu sygnałów makro, wydarzeń i analiz',3);if(outlook.direction&&outlook.direction!==ps?.outlook?.direction)add('outlook',`Globalny Analityk: ${ps?.outlook?.direction||'—'} → ${outlook.direction}`,`zgodność ${outlook.agreement||'—'}/100`,3);if(evt?.next?.type!==ps?.events?.next?.type||evt?.next?.ts!==ps?.events?.next?.ts){if(evt?.next)add('event',`Następne wydarzenie: ${evt.next.title}`,new Date(evt.next.ts).toLocaleString('pl-PL',{timeZone:'Europe/Warsaw'}),evt.next.importance||2);}if(n(cvol.value)!==null&&n(ps?.cvol?.cvol)!==null&&Math.abs(n(cvol.value)-n(ps.cvol.cvol))>=1)add('volatility',`CVOL zmienił się: ${n(ps.cvol.cvol).toFixed(1)} → ${n(cvol.value).toFixed(1)}`,'zmiana oczekiwanej zmienności rynku',2);}

const prevPoliticalIds=new Set((ps?.politics?.items||[]).map(x=>hash((x.title||'').toLowerCase())));
for(const x of (politics.items||[])){const k=hash((x.title||'').toLowerCase());if(!prevPoliticalIds.has(k))changes.push({kind:'news',title:x.title,detail:`${x.category} • ${x.mechanism}`,importance:Math.abs(x.goldImpact)>=2?3:2,url:x.url||'',ts:x.ts||now,key:'news-'+k});}
const prevOutlookIds=new Set((ps?.outlook?.items||[]).map(x=>hash((x.title||'').toLowerCase())));
for(const x of (outlook.items||[])){const k=hash((x.title||'').toLowerCase());if(!prevOutlookIds.has(k))changes.push({kind:'research',title:`${x.org}: ${x.title}`,detail:(x.reasons||[]).join(', '),importance:2,url:x.url||'',ts:now,key:'research-'+k});}

let timeline=Array.isArray(prevTimeline?.events)?prevTimeline.events:[];
const existing=new Set(timeline.map(x=>x.key||eventKey(x)));
for(const c of changes){c.key=c.key||eventKey(c);if(!existing.has(c.key)){timeline.push(c);existing.add(c.key);}}
timeline=timeline.filter(x=>Number(x.ts)>now-8*24*3600*1000).sort((a,b)=>a.ts-b.ts).slice(-1200);

const analytics={schema:2,generatedAt:iso,modules,snapshot};
await fs.writeFile(`${OUT_DIR}/analytics-latest.json`,JSON.stringify(analytics,null,2));
await fs.writeFile(`${OUT_DIR}/timeline.json`,JSON.stringify({schema:1,generatedAt:iso,events:timeline},null,2));
console.log(JSON.stringify({generatedAt:iso,publicOutlookScore:publicOutlook,newChanges:changes.length,timeline:timeline.length,nextEvent:evt?.next?.title||null},null,2));
