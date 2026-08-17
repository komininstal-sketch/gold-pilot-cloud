import fs from 'node:fs/promises';

const OUT_DIR=process.env.OUT_DIR||'/tmp/gold-pilot-out';
const PREV_NEWS=process.env.PREV_NEWS||'/tmp/gold-pilot-prev-news.json';
const UA='Mozilla/5.0 (GoldPilotCloud-News/1.2; +https://github.com/komininstal-sketch/gold-pilot-cloud)';
const now=Date.now();
const iso=new Date(now).toISOString();

function clean(s=''){
  return String(s).replace(/!\[[^\]]*\]\([^)]+\)/g,' ').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/<[^>]+>/g,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
}
function hash(s=''){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
function clamp(x,a=-3.5,b=3.5){return Math.max(a,Math.min(b,x));}
async function readJson(path,fallback=null){try{return JSON.parse(await fs.readFile(path,'utf8'));}catch{return fallback;}}
async function fetchText(url,timeout=14000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{headers:{'user-agent':UA,'accept-language':'pl-PL,pl;q=0.9,en;q=0.8'},signal:c.signal,redirect:'follow'});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.text();}finally{clearTimeout(t);}}
async function fetchJson(url,timeout=14000){return JSON.parse(await fetchText(url,timeout));}
async function reader(url){try{return await fetchText('https://r.jina.ai/'+url,15000);}catch{return await fetchText(url,12000);}}

function allowedDomain(domain=''){
  const d=domain.toLowerCase().replace(/^www\./,'');
  return ['reuters.com','apnews.com','fxmag.pl','bankier.pl','stooq.pl','investing.com','marketwatch.com','cnbc.com','kitco.com','fxstreet.com','finance.yahoo.com','bloomberg.com','wsj.com','businessinsider.com'].some(x=>d===x||d.endsWith('.'+x));
}
function sourceName(domain=''){
  const d=domain.toLowerCase();
  if(d.includes('reuters.com'))return 'Reuters'; if(d.includes('apnews.com'))return 'AP'; if(d.includes('fxmag.pl'))return 'FXMAG'; if(d.includes('bankier.pl'))return 'Bankier'; if(d.includes('stooq.pl'))return 'Stooq'; if(d.includes('investing.com'))return 'Investing.com'; if(d.includes('marketwatch.com'))return 'MarketWatch'; if(d.includes('cnbc.com'))return 'CNBC'; if(d.includes('kitco.com'))return 'Kitco'; if(d.includes('fxstreet.com'))return 'FXStreet'; if(d.includes('bloomberg.com'))return 'Bloomberg'; if(d.includes('wsj.com'))return 'WSJ'; if(d.includes('finance.yahoo.com'))return 'Yahoo Finance'; return domain.replace(/^www\./,'')||'Źródło';
}
function sourceWeight(domain=''){
  const d=domain.toLowerCase();
  if(d.includes('reuters.com')||d.includes('apnews.com'))return 1.25;
  if(d.includes('bloomberg.com')||d.includes('wsj.com'))return 1.15;
  if(d.includes('fxmag.pl')||d.includes('bankier.pl')||d.includes('stooq.pl'))return 1.10;
  if(d.includes('kitco.com')||d.includes('fxstreet.com'))return 1.07;
  return 1.00;
}
function parseSeen(x){
  if(!x)return now; const s=String(x).trim();
  if(/^\d{8}T\d{6}Z$/.test(s)){const y=s.slice(0,4),m=s.slice(4,6),d=s.slice(6,8),hh=s.slice(9,11),mm=s.slice(11,13),ss=s.slice(13,15);return Date.parse(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`)||now;}
  const t=Date.parse(s); return Number.isFinite(t)?t:now;
}

function inferImpact(title=''){
  const s=title.toLowerCase();
  let gold=0,usd=0,usdpln=0,importance=1;
  const hit=rx=>rx.test(s);

  const geo=hit(/\bwar\b|wojn|\battack\b|atak|sanction|sankcj|\biran\b|ukrain|russia|rosj|israel|izrael|\bnato\b|taiwan|tajwan|geopol|tariff|\bcła\b|\bcla\b/);
  const deesc=hit(/ceasefire|zawieszenie broni|de-?escal|deeskal/);
  const dovish=hit(/rate cut|cuts rates|obniżk.*st[oó]p|dovish|gołębi|weaker dollar|słabsz.*dolar|dollar falls|dolar spada|podwyżk.*st[oó]p.{0,40}(malej|spad|mniej)|szanse.{0,30}podwyżk.{0,30}(malej|spad)/);
  const hawkish=!dovish && hit(/rate hike|podwyżk.*st[oó]p|hawkish|jastrzębi|strong dollar|siln.*dolar|dollar rises|dolar rośnie|yields rise|rentownoś.*rosn/);

  if(geo){gold+=1.4;usd+=.4;usdpln+=.4;importance=3;}
  if(deesc){gold-=1.0;usd-=.2;importance=Math.max(importance,2);}
  if(dovish){gold+=1.5;usd-=1.4;usdpln-=1.0;importance=3;}
  if(hawkish){gold-=1.4;usd+=1.5;usdpln+=1.0;importance=3;}
  if(hit(/inflation|inflacja|\bcpi\b|\bppi\b|\bpce\b/))importance=Math.max(importance,2);
  if(hit(/jobs|payroll|employment|bezroboc|\bnfp\b/))importance=Math.max(importance,3);
  if(hit(/\bfed\b|fomc|powell|\becb\b|\bnbp\b|\brpp\b|bank central/))importance=Math.max(importance,3);
  if(hit(/stocks fall|stocks slide|selloff|wyprzedaż|giełd.*spad|akcj.*spad|risk-off/)){gold+=.9;usd+=.3;importance=Math.max(importance,2);}
  if(hit(/stocks rise|rally|giełd.*wzrost|akcj.*rosn|risk-on/)){gold-=.4;importance=Math.max(importance,2);}
  if(hit(/gold rises|gold up|złot.*w g[oó]r|cena złota rośnie|xau.*rise/))gold+=.5;
  if(hit(/gold falls|gold down|złot.*spad|cena złota spada|xau.*fall/))gold-=.5;
  if(hit(/złoty umacnia|pln.*umac|stronger zloty/)){usdpln-=1.2;importance=Math.max(importance,2);}
  if(hit(/złoty słab|pln.*słab|weaker zloty/)){usdpln+=1.2;importance=Math.max(importance,2);}
  return {goldImpact:clamp(gold),usdImpact:clamp(usd),usdPlnImpact:clamp(usdpln),importance};
}

const CATEGORIES=[
  {id:'gold',label:'Złoto i metale',query:'(gold OR XAUUSD OR "XAU/USD" OR silver OR "precious metals")'},
  {id:'fx',label:'Waluty',query:'(dollar OR forex OR "USD/PLN" OR USDPLN OR "EUR/USD" OR EURUSD OR zloty OR PLN)'},
  {id:'rates',label:'Fed, stopy i obligacje',query:'("Federal Reserve" OR FOMC OR Fed OR "interest rates" OR yields OR bonds OR Treasury)'},
  {id:'stocks',label:'Giełdy i akcje',query:'(stocks OR equities OR "S&P 500" OR Nasdaq OR "Dow Jones" OR WIG20 OR GPW)'},
  {id:'economy',label:'Gospodarka',query:'(economy OR GDP OR CPI OR inflation OR employment OR payrolls OR recession)'},
  {id:'poland',label:'Polska',query:'(Poland OR Polish OR zloty OR PLN OR NBP OR GPW OR WIG20)'},
  {id:'geo',label:'Geopolityka',query:'(Ukraine OR Russia OR Iran OR Israel OR China OR Taiwan OR sanctions OR tariffs OR war OR ceasefire OR NATO)'}
];
const CAT_LABEL=Object.fromEntries(CATEGORIES.map(x=>[x.id,x.label]));

async function gdeltCategory(cat){
  const url='https://api.gdeltproject.org/api/v2/doc/doc?query='+encodeURIComponent(cat.query)+'&mode=artlist&format=json&maxrecords=75&timespan=36h&sort=datedesc';
  try{
    const j=await fetchJson(url,16000); const arr=Array.isArray(j?.articles)?j.articles:[];
    return arr.map(a=>{const title=clean(a.title||'');const domain=String(a.domain||'').toLowerCase();const ts=parseSeen(a.seendate||a.seenDate||a.date);const imp=inferImpact(title);return {id:hash(`${cat.id}|${title}|${a.url||''}`),category:cat.id,categoryLabel:cat.label,title,url:a.url||'',domain,source:sourceName(domain),ts,seen:new Date(ts).toISOString(),...imp,sourceWeight:sourceWeight(domain),origin:'GDELT'};}).filter(x=>x.title.length>18&&/^https?:\/\//.test(x.url)&&allowedDomain(x.domain));
  }catch{return [];}
}

function resolveFxmagUrl(raw){try{return new URL(raw,'https://www.fxmag.pl').href;}catch{return '';}}
function directArticleAllowed(category,title,url){
  if(title.length<28)return false; let u;try{u=new URL(url);}catch{return false;}
  const host=u.hostname.toLowerCase(),path=u.pathname.toLowerCase();
  if(!host.endsWith('fxmag.pl')||host.startsWith('admin.'))return false;
  if(/\/ranking\/|\/kalkulator|\/tag\/|\/autor\/|\/kontakt|\/regulamin|\/polityka|\/newsletter/.test(path))return false;
  if(/^(waluty|giełda|gielda|gospodarka|złoto|zloto|surowce|inwestowanie|brokerzy|indeksy|kursy walut)$/i.test(title.trim()))return false;
  if(category==='gold')return (/\/surowce\//.test(path)||/\/inwestowanie\//.test(path)) && /złot|zlot|gold|xau|srebr|silver|kruszc/i.test(title);
  if(category==='fx')return /\/waluty\//.test(path) && !/\/waluty\/?$/.test(path);
  if(category==='stocks')return /\/gielda\//.test(path) && !/\/gielda\/?$/.test(path);
  if(category==='economy')return /\/gospodarka\//.test(path) && !/\/gospodarka\/?$/.test(path);
  return false;
}
function parseReaderLinks(text,category,categoryLabel,source){
  const out=[]; const rx=/\[([^\]]{18,240})\]\(([^)]+)\)/g; let m;
  while((m=rx.exec(String(text||'')))&&out.length<24){const title=clean(m[1]);const url=resolveFxmagUrl(m[2]);if(!directArticleAllowed(category,title,url))continue;const domain=new URL(url).hostname.toLowerCase();const imp=inferImpact(title);out.push({id:hash(`${category}|${title}|${url}`),category,categoryLabel,title,url,domain,source,ts:now,seen:iso,...imp,sourceWeight:1.10,origin:'DIRECT'});}return out;
}
async function fxmagDirect(){
  const defs=[['gold','Złoto i metale','FXMAG','https://www.fxmag.pl/inwestowanie/kruszce/zloto'],['fx','Waluty','FXMAG','https://www.fxmag.pl/waluty'],['stocks','Giełdy i akcje','FXMAG','https://www.fxmag.pl/gielda'],['economy','Gospodarka','FXMAG','https://www.fxmag.pl/gospodarka']];
  const all=[];await Promise.all(defs.map(async d=>{try{const t=await reader(d[3]);all.push(...parseReaderLinks(t,d[0],d[1],d[2]));}catch{}}));return all;
}

function extraCategories(title=''){
  const s=title.toLowerCase(),out=[];
  if(/złot|zlot|gold|xau|srebr|silver|kruszc/.test(s))out.push('gold');
  if(/dolar|dollar|forex|usd.?pln|eur.?usd|złot[yego]|zloty|\bpln\b|walut/.test(s))out.push('fx');
  if(/\bfed\b|fomc|powell|st[oó]p|rentowno|obligac|yield|treasury|\bnbp\b|\brpp\b/.test(s))out.push('rates');
  if(/giełd|gield|akcj|stock|equities|nasdaq|s&p|dow jones|wig20|\bgpw\b/.test(s))out.push('stocks');
  if(/gospodar|econom|\bpkb\b|\bgdp\b|inflac|\bcpi\b|bezrob|employment|payroll|reces/.test(s))out.push('economy');
  if(/polsk|poland|złot[yego]|zloty|\bpln\b|\bnbp\b|\brpp\b|\bgpw\b|wig20/.test(s))out.push('poland');
  if(/\biran\b|ukrain|russia|rosj|israel|izrael|china|chiny|taiwan|tajwan|sankcj|sanction|cła|tariff|\bwar\b|wojn|nato|ceasefire|deeskal/.test(s))out.push('geo');
  return [...new Set(out)];
}
function expandCategories(items){
  const out=[];
  for(const x of items){const cats=new Set([x.category,...extraCategories(x.title)]);for(const cat of cats){if(!CAT_LABEL[cat])continue;const y={...x,category:cat,categoryLabel:CAT_LABEL[cat]};y.id=hash(`${cat}|${x.title}|${x.url}`);out.push(y);}}return out;
}
function dedupe(items){const map=new Map();for(const x of items){if(!x.title||!x.url)continue;const norm=x.category+'|'+x.title.toLowerCase().replace(/[^a-ząćęłńóśźż0-9]+/gi,' ').trim().slice(0,130);const p=map.get(norm);if(!p||(x.sourceWeight||0)>(p.sourceWeight||0)||x.ts>p.ts)map.set(norm,x);}return [...map.values()];}

const previous=await readJson(PREV_NEWS,null);
const categoryResults=await Promise.all(CATEGORIES.map(gdeltCategory));
const direct=await fxmagDirect();
let items=dedupe(expandCategories(categoryResults.flat().concat(direct)));
const prevByKey=new Map((previous?.items||[]).map(x=>[(x.category+'|'+x.url),x]));
for(const x of items){const p=prevByKey.get(x.category+'|'+x.url);if(x.origin==='DIRECT'&&p?.ts){x.ts=p.ts;x.seen=p.seen||new Date(p.ts).toISOString();}x.firstSeenTs=p?.firstSeenTs||x.ts||now;const imp=inferImpact(x.title);x.goldImpact=imp.goldImpact;x.usdImpact=imp.usdImpact;x.usdPlnImpact=imp.usdPlnImpact;x.importance=imp.importance;}
items=items.filter(x=>x.title.length>=20&&!/kalkulator|lokaty|konto oszczędnościowe|kantor internetowy|brokerzy zagraniczni|profil icon|indeksy zagraniczne$/i.test(x.title));
items.forEach(x=>{const ageH=Math.max(0,(now-x.ts)/3600000),fresh=Math.max(0,36-ageH)/36;x.rank=(x.importance||1)*20+(x.sourceWeight||1)*15+fresh*25+(x.category==='gold'?9:0)+(x.category==='fx'?6:0)+(x.category==='rates'?7:0)+(x.category==='poland'?5:0)+(x.category==='geo'?6:0);});
items.sort((a,b)=>b.rank-a.rank||b.ts-a.ts);items=items.slice(0,160);
const counts={};for(const c of CATEGORIES)counts[c.id]=items.filter(x=>x.category===c.id).length;
const output={schema:2,generatedAt:iso,fetchedAt:iso,categories:CATEGORIES.map(({id,label})=>({id,label,count:counts[id]||0})),items,summary:{total:items.length,highImportance:items.filter(x=>x.importance>=3).length,counts}};
await fs.mkdir(OUT_DIR,{recursive:true});await fs.writeFile(`${OUT_DIR}/news.json`,JSON.stringify(output,null,2));console.log(JSON.stringify({news:'LIVE',items:items.length,highImportance:output.summary.highImportance,counts},null,2));
