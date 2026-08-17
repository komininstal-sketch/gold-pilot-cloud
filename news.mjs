import fs from 'node:fs/promises';

const OUT_DIR=process.env.OUT_DIR||'/tmp/gold-pilot-out';
const PREV_NEWS=process.env.PREV_NEWS||'/tmp/gold-pilot-prev-news.json';
const UA='Mozilla/5.0 (GoldPilotCloud-News/1.0; +https://github.com/komininstal-sketch/gold-pilot-cloud)';
const now=Date.now();
const iso=new Date(now).toISOString();

function clean(s=''){
  return String(s)
    .replace(/!\[[^\]]*\]\([^)]+\)/g,' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g,'$1')
    .replace(/<[^>]+>/g,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/g,"'")
    .replace(/\s+/g,' ')
    .trim();
}
function hash(s=''){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
function clamp(x,a=-3.5,b=3.5){return Math.max(a,Math.min(b,x));}
async function readJson(path,fallback=null){try{return JSON.parse(await fs.readFile(path,'utf8'));}catch{return fallback;}}
async function fetchText(url,timeout=14000){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{headers:{'user-agent':UA,'accept-language':'pl-PL,pl;q=0.9,en;q=0.8'},signal:c.signal,redirect:'follow'});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);return await r.text();}finally{clearTimeout(t);}}
async function fetchJson(url,timeout=14000){return JSON.parse(await fetchText(url,timeout));}
async function reader(url){try{return await fetchText('https://r.jina.ai/'+url,15000);}catch{return await fetchText(url,12000);}}
function ageMin(stamp){if(!stamp)return Infinity;const t=new Date(stamp).getTime();return Number.isFinite(t)?(now-t)/60000:Infinity;}

function sourceName(domain=''){
  const d=domain.toLowerCase();
  if(d.includes('reuters.com'))return 'Reuters';
  if(d.includes('apnews.com'))return 'AP';
  if(d.includes('fxmag.pl'))return 'FXMAG';
  if(d.includes('bankier.pl'))return 'Bankier';
  if(d.includes('stooq.pl'))return 'Stooq';
  if(d.includes('investing.com'))return 'Investing.com';
  if(d.includes('marketwatch.com'))return 'MarketWatch';
  if(d.includes('cnbc.com'))return 'CNBC';
  return domain.replace(/^www\./,'')||'Źródło';
}
function sourceWeight(domain=''){
  const d=domain.toLowerCase();
  if(d.includes('reuters.com')||d.includes('apnews.com'))return 1.20;
  if(d.includes('fxmag.pl')||d.includes('bankier.pl')||d.includes('stooq.pl'))return 1.05;
  if(d.includes('cnbc.com')||d.includes('marketwatch.com'))return 1.00;
  return .90;
}
function parseSeen(x){
  if(!x)return now;
  const s=String(x).trim();
  if(/^\d{8}T\d{6}Z$/.test(s)){
    const y=s.slice(0,4),m=s.slice(4,6),d=s.slice(6,8),hh=s.slice(9,11),mm=s.slice(11,13),ss=s.slice(13,15);
    return Date.parse(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`)||now;
  }
  const t=Date.parse(s);
  return Number.isFinite(t)?t:now;
}

function inferImpact(title=''){
  const s=title.toLowerCase();
  let gold=0,usd=0,usdpln=0,importance=1;
  const hit=rx=>rx.test(s);

  if(hit(/war|wojn|attack|atak|sanction|sankcj|iran|ukrain|russia|rosj|israel|nato|taiwan|geopol|tariff|cł/)){gold+=1.4;usd+=.4;usdpln+=.4;importance=3;}
  if(hit(/ceasefire|zawieszenie broni|de-?escal|deeskal/)){gold-=1.0;usd-=.2;importance=2;}
  if(hit(/rate cut|cuts rates|obniżk.*st[oó]p|dovish|gołębi|weaker dollar|słabsz.*dolar|dollar falls|dolar spada/)){gold+=1.5;usd-=1.4;usdpln-=1.0;importance=3;}
  if(hit(/rate hike|podwyżk.*st[oó]p|hawkish|jastrzębi|strong dollar|siln.*dolar|dollar rises|dolar rośnie|yields rise|rentownoś.*rosn/)){gold-=1.4;usd+=1.5;usdpln+=1.0;importance=3;}
  if(hit(/inflation|inflacja|cpi|ppi|pce/)){importance=Math.max(importance,2);}
  if(hit(/jobs|payroll|employment|bezroboc|nfp/)){importance=Math.max(importance,3);}
  if(hit(/fed|fomc|powell|ecb|nbp|rpp|bank central/)){importance=Math.max(importance,3);}
  if(hit(/stocks fall|stocks slide|selloff|wyprzedaż|giełd.*spad|akcj.*spad|risk-off/)){gold+=.9;usd+=.3;importance=Math.max(importance,2);}
  if(hit(/stocks rise|rally|giełd.*wzrost|akcj.*rosn|risk-on/)){gold-=.4;importance=Math.max(importance,2);}
  if(hit(/gold rises|gold up|złot.*w g[oó]r|cena złota rośnie|xau.*rise/)){gold+=.5;}
  if(hit(/gold falls|gold down|złot.*spad|cena złota spada|xau.*fall/)){gold-=.5;}
  if(hit(/złoty umacnia|pln.*umac|stronger zloty/)){usdpln-=1.2;importance=Math.max(importance,2);}
  if(hit(/złoty słab|pln.*słab|weaker zloty/)){usdpln+=1.2;importance=Math.max(importance,2);}

  return {goldImpact:clamp(gold),usdImpact:clamp(usd),usdPlnImpact:clamp(usdpln),importance};
}

const SOURCE_FILTER='(domainis:reuters.com OR domainis:apnews.com OR domainis:fxmag.pl OR domainis:bankier.pl OR domainis:stooq.pl OR domainis:investing.com OR domainis:marketwatch.com OR domainis:cnbc.com)';
const CATEGORIES=[
  {id:'gold',label:'Złoto i metale',query:`(gold OR zloto OR złoto OR XAUUSD OR "XAU/USD" OR silver OR srebro OR "precious metals") ${SOURCE_FILTER}`},
  {id:'fx',label:'Waluty',query:`(dollar OR dolar OR forex OR "USD/PLN" OR USDPLN OR "EUR/USD" OR EURUSD OR zloty OR złoty OR PLN) ${SOURCE_FILTER}`},
  {id:'rates',label:'Fed, stopy i obligacje',query:`("Federal Reserve" OR FOMC OR Fed OR "interest rates" OR stopy OR yields OR rentownosci OR rentowności OR bonds OR obligacje OR Treasury) ${SOURCE_FILTER}`},
  {id:'stocks',label:'Giełdy i akcje',query:`(stocks OR equities OR akcje OR gielda OR giełda OR "S&P 500" OR Nasdaq OR "Dow Jones" OR WIG20 OR GPW) ${SOURCE_FILTER}`},
  {id:'economy',label:'Gospodarka',query:`(economy OR gospodarka OR GDP OR PKB OR CPI OR inflation OR inflacja OR employment OR payrolls OR recession OR recesja) ${SOURCE_FILTER}`},
  {id:'poland',label:'Polska',query:`(Poland OR Polska OR Polish OR polski OR zloty OR złoty OR PLN OR NBP OR RPP OR GPW OR WIG20) ${SOURCE_FILTER}`},
  {id:'geo',label:'Geopolityka',query:`(Ukraine OR Ukraina OR Russia OR Rosja OR Iran OR Israel OR Izrael OR China OR Chiny OR Taiwan OR Tajwan OR sanctions OR sankcje OR tariffs OR cla OR cła OR war OR wojna OR ceasefire OR NATO) ${SOURCE_FILTER}`}
];

async function gdeltCategory(cat){
  const url='https://api.gdeltproject.org/api/v2/doc/doc?'+
    'query='+encodeURIComponent(cat.query)+
    '&mode=artlist&format=json&maxrecords=35&timespan=36h&sort=datedesc';
  try{
    const j=await fetchJson(url,15000);
    const arr=Array.isArray(j?.articles)?j.articles:[];
    return arr.map(a=>{
      const title=clean(a.title||'');
      const domain=String(a.domain||'').toLowerCase();
      const ts=parseSeen(a.seendate||a.seenDate||a.date);
      const imp=inferImpact(title);
      return {
        id:hash(`${cat.id}|${title}|${a.url||''}`),category:cat.id,categoryLabel:cat.label,
        title,url:a.url||'',domain,source:sourceName(domain),ts,seen:new Date(ts).toISOString(),
        ...imp,sourceWeight:sourceWeight(domain),origin:'GDELT'
      };
    }).filter(x=>x.title.length>12&&/^https?:\/\//.test(x.url));
  }catch(e){return [];}
}

function parseReaderLinks(text,category,categoryLabel,source,urlBase){
  const out=[];
  const rx=/\[([^\]]{18,220})\]\((https?:\/\/[^)]+)\)/g;
  let m;
  while((m=rx.exec(String(text||'')))&&out.length<18){
    const title=clean(m[1]);
    const url=m[2];
    if(!title||/facebook|youtube|linkedin|twitter|instagram|cookie|privacy|kontakt|contact|reklama/i.test(title))continue;
    const domain=(()=>{try{return new URL(url).hostname.toLowerCase();}catch{return '';}})();
    const imp=inferImpact(title);
    out.push({
      id:hash(`${category}|${title}|${url}`),category,categoryLabel,title,url,domain,
      source,ts:now,seen:iso,...imp,sourceWeight:1.05,origin:'DIRECT'
    });
  }
  return out;
}

async function fxmagDirect(){
  const defs=[
    ['gold','Złoto i metale','FXMAG','https://www.fxmag.pl/inwestowanie/kruszce/zloto'],
    ['fx','Waluty','FXMAG','https://www.fxmag.pl/waluty'],
    ['stocks','Giełdy i akcje','FXMAG','https://www.fxmag.pl/gielda'],
    ['economy','Gospodarka','FXMAG','https://www.fxmag.pl/gospodarka']
  ];
  const all=[];
  await Promise.all(defs.map(async d=>{try{const t=await reader(d[3]);all.push(...parseReaderLinks(t,d[0],d[1],d[2],d[3]));}catch{}}));
  return all;
}

function dedupe(items){
  const map=new Map();
  for(const x of items){
    if(!x.title||!x.url)continue;
    const normalized=x.title.toLowerCase().replace(/[^a-ząćęłńóśźż0-9]+/gi,' ').trim().slice(0,120);
    const key=normalized||x.url;
    const prev=map.get(key);
    if(!prev || (x.sourceWeight||0)>(prev.sourceWeight||0) || x.ts>prev.ts)map.set(key,x);
  }
  return [...map.values()];
}

const previous=await readJson(PREV_NEWS,null);
if(previous && ageMin(previous.fetchedAt)<9){
  previous.generatedAt=iso;
  await fs.mkdir(OUT_DIR,{recursive:true});
  await fs.writeFile(`${OUT_DIR}/news.json`,JSON.stringify(previous,null,2));
  console.log(JSON.stringify({news:'CACHE',items:previous.items?.length||0,fetchedAt:previous.fetchedAt},null,2));
  process.exit(0);
}

const categoryResults=await Promise.all(CATEGORIES.map(gdeltCategory));
const direct=await fxmagDirect();
let items=dedupe(categoryResults.flat().concat(direct));

// Usuń ewidentną nawigację / strony kategorii.
items=items.filter(x=>!/^złoto$/i.test(x.title)&&!/^waluty$/i.test(x.title)&&!/^gospodarka$/i.test(x.title)&&!/^giełda$/i.test(x.title));

// Ranking: świeżość + znaczenie + jakość źródła.
items.forEach(x=>{
  const ageH=Math.max(0,(now-x.ts)/3600000);
  const fresh=Math.max(0,36-ageH)/36;
  x.rank=(x.importance||1)*20+(x.sourceWeight||1)*15+fresh*25+
    (x.category==='gold'?8:0)+(x.category==='fx'?6:0)+(x.category==='rates'?6:0)+(x.category==='poland'?5:0);
});
items.sort((a,b)=>b.rank-a.rank || b.ts-a.ts);
items=items.slice(0,100);

const counts={};
for(const c of CATEGORIES)counts[c.id]=items.filter(x=>x.category===c.id).length;

const output={
  schema:1,generatedAt:iso,fetchedAt:iso,
  categories:CATEGORIES.map(({id,label})=>({id,label,count:counts[id]||0})),
  items,
  summary:{total:items.length,highImportance:items.filter(x=>x.importance>=3).length,counts}
};

await fs.mkdir(OUT_DIR,{recursive:true});
await fs.writeFile(`${OUT_DIR}/news.json`,JSON.stringify(output,null,2));
console.log(JSON.stringify({news:'LIVE',items:items.length,highImportance:output.summary.highImportance,counts},null,2));
