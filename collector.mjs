import fs from 'node:fs/promises';
import path from 'node:path';

const OZ = 31.1034768;
const OUT_DIR = process.env.OUT_DIR || 'out';
const PREVIOUS_FILE = process.env.PREVIOUS_FILE || '/tmp/gold-pilot-prev.json';
const MAX_POINTS = 8 * 24 * 12; // 8 dni przy interwale 5 min

const UA = 'Mozilla/5.0 (GoldPilotCloud/1.0; +https://github.com/komininstal-sketch/gold-pilot-cloud)';

function n(v){
  if(v===null||v===undefined)return null;
  let s=String(v).trim().replace(/\u00a0/g,' ').replace(/[’']/g,'');
  s=s.replace(/[^0-9,.-]/g,'').trim();
  if(!s)return null;
  const ci=s.lastIndexOf(','), di=s.lastIndexOf('.');
  if(ci>=0&&di>=0){
    s=di>ci?s.replace(/,/g,''):s.replace(/\./g,'').replace(',','.');
  }else if(ci>=0){
    s=(s.length-ci-1===2)?s.replace(',','.'):s.replace(/,/g,'');
  }else if(di>=0 && s.length-di-1!==2){
    s=s.replace(/\./g,'');
  }
  const x=Number(s);
  return Number.isFinite(x)?x:null;
}

async function fetchText(url,{timeout=9000}={}){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),timeout);
  try{
    const r=await fetch(url,{headers:{'user-agent':UA,'accept-language':'en-US,en;q=0.9,pl;q=0.8'},signal:ctrl.signal,redirect:'follow'});
    if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);
    return await r.text();
  }finally{clearTimeout(timer);}
}

async function fetchJson(url,opts){
  return JSON.parse(await fetchText(url,opts));
}

async function firstOk(label, fns){
  const errors=[];
  for(const fn of fns){
    try{return {ok:true,value:await fn(),error:null};}
    catch(e){errors.push(String(e?.message||e));}
  }
  return {ok:false,value:null,error:`${label}: ${errors.join(' | ')}`};
}

function stripHtml(s=''){
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/\s+/g,' ')
    .trim();
}

function near(text,needle,radius=3500){
  const i=String(text).toLowerCase().indexOf(String(needle).toLowerCase());
  if(i<0)return '';
  return String(text).slice(Math.max(0,i-radius),Math.min(String(text).length,i+radius));
}

function rxPrice(text,arr){
  for(const rx of arr){
    const m=String(text).match(rx);
    if(m){const v=n(m[1]); if(v>0)return v;}
  }
  return null;
}

async function readerOrDirect(url){
  return await firstOk(url,[
    ()=>fetchText(url),
    ()=>fetchText('https://r.jina.ai/'+url,{timeout:12000})
  ]);
}

async function getGold(){
  const j=await fetchJson('https://api.gold-api.com/price/XAU');
  const p=n(j?.price);
  if(!(p>0))throw new Error('Brak XAU/USD');
  return {price:p,updatedAt:j?.updatedAt||j?.updated_at||null};
}

async function yahoo(symbol){
  const u=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m&includePrePost=true`;
  const j=await fetchJson(u);
  const r=j?.chart?.result?.[0];
  const meta=r?.meta||{};
  let price=n(meta.regularMarketPrice);
  let at=n(meta.regularMarketTime);
  if(!(price>0)){
    const q=r?.indicators?.quote?.[0]?.close||[];
    for(let i=q.length-1;i>=0;i--){const v=n(q[i]);if(v>0){price=v;at=n(r?.timestamp?.[i]);break;}}
  }
  if(!(price>0))throw new Error(`Brak Yahoo ${symbol}`);
  return {price,updatedAt:at?new Date(at*1000).toISOString():null};
}

async function frankfurter(from,to){
  const j=await fetchJson(`https://api.frankfurter.dev/v2/rate/${from}/${to}`);
  const rate=n(j?.rate);
  if(!(rate>0))throw new Error(`Brak ${from}/${to}`);
  return rate;
}

async function nbpGold(){
  const j=await fetchJson('https://api.nbp.pl/api/cenyzlota/last/1/?format=json');
  const p=n(j?.[0]?.cena);
  if(!(p>0))throw new Error('Brak NBP gold');
  return {price:p,date:j?.[0]?.data||null};
}

async function tavex(){
  const url='https://tavex.pl/zloto/zlota-sztabka-argor-heraeus-10-g/';
  const r=await readerOrDirect(url); if(!r.ok)throw new Error(r.error);
  const text=stripHtml(r.value);
  const s=near(text,'Sztabka złota 10g Argor-Heraeus',5500)||text;
  const sale=rxPrice(s,[/Aktualna cena sprzedaży 1 szt\.?\s*([\d\s.,]+)\s*zł/i,/Sprzedaż\s+Skup\s+Spread\s+1-2\s+([\d\s.,]+)\s*zł/i,/Cena łączna\s+([\d\s.,]+)\s*zł/i]);
  const buy=rxPrice(s,[/Aktualna cena skupu 1 szt\.?\s*([\d\s.,]+)\s*zł/i,/Skup\s+([\d\s.,]+)\s*zł/i]);
  if(!(sale>0))throw new Error('Parser Tavex: brak ceny sprzedaży');
  return {name:'Tavex Polska',currency:'PLN',sale,buyback:buy,url};
}

async function stonex(){
  const url='https://stonexbullion.com/en/gold-bars/10g/10g-gold-bar-argor-heraeus/';
  const r=await readerOrDirect(url); if(!r.ok)throw new Error(r.error);
  const text=stripHtml(r.value);
  const s=near(text,'10g Gold Bar | Argor-Heraeus',5500)||text;
  const sale=rxPrice(s,[/10g Gold Bar \| Argor-Heraeus\s*€\s*([\d\s.,]+)/i,/€\s*([\d,.]+)\s*\|\s*Gross/i,/€\s*([\d,.]+)\s+Gross/i]);
  const buy=rxPrice(s,[/Buy back\s*€\s*([\d\s.,]+)/i,/Buyback\s*€\s*([\d\s.,]+)/i]);
  if(!(sale>0))throw new Error('Parser StoneX: brak ceny');
  return {name:'StoneX Bullion',currency:'EUR',sale,buyback:buy,url};
}

async function degussa(){
  const url='https://degussa.com/ch-en/header_navigation/prices/price-list/';
  const r=await readerOrDirect(url); if(!r.ok)throw new Error(r.error);
  const text=stripHtml(r.value).replace(/\u00a0/g,' ');
  let s=near(text,'100109/01 Gold bar - 10 g - Degussa New Design',1800);
  if(!s)s=near(text,'Gold bar - 10 g - Degussa New Design',1800)||text;
  const exact=s.match(/(?:100109\/01\s*)?Gold bar\s*-\s*10 g\s*-\s*Degussa New Design[\s\S]{0,300}?Purchase net:\s*CHF\s*([\d'’.,\s]+?)\s+Sell:\s*CHF\s*([\d'’.,\s]+?)\s+Last price update/i);
  let buy=exact?n(exact[1]):null;
  let sale=exact?n(exact[2]):null;
  if(!(buy>0))buy=rxPrice(s,[/Purchase net:\s*CHF\s*([\d'’.,\s]+)/i]);
  if(!(sale>0))sale=rxPrice(s,[/Sell:\s*CHF\s*([\d'’.,\s]+)/i]);
  if(!(sale>=500&&sale<=5000))throw new Error('Parser Degussa: brak/nieprawidłowa cena 10 g');
  if(!(buy>=500&&buy<=5000))buy=null;
  return {name:'Degussa Switzerland',currency:'CHF',sale,buyback:buy,url};
}

async function philoro(){
  const url='https://philoro.ch/shop/goldbarren';
  const r=await readerOrDirect(url); if(!r.ok)throw new Error(r.error);
  const text=stripHtml(r.value);
  let s=near(text,'Goldbarren 10 g diverse Hersteller',3500);
  if(!s)s=near(text,'Gold bar 10 g various manufacturer',3500)||text;
  const sale=rxPrice(s,[/Kaufen:\s*([\d'’.,\s]+)\s*CHF/i,/buy:\s*CHF\s*([\d'’.,\s]+)/i,/Buy:\s*CHF\s*([\d'’.,\s]+)/i]);
  const buy=rxPrice(s,[/Verkaufen:\s*([\d'’.,\s]+)\s*CHF/i,/sell:\s*CHF\s*([\d'’.,\s]+)/i,/Sell:\s*CHF\s*([\d'’.,\s]+)/i]);
  if(!(sale>0))throw new Error('Parser philoro: brak ceny');
  return {name:'philoro Switzerland',currency:'CHF',sale,buyback:buy,url};
}

function convertDealer(d,eurPln,chfPln){
  if(!d)return null;
  const fx=d.currency==='EUR'?eurPln:d.currency==='CHF'?chfPln:1;
  const salePln=d.sale>0&&fx>0?d.sale*fx:null;
  const buybackPln=d.buyback>0&&fx>0?d.buyback*fx:null;
  return {...d,salePln,buybackPln};
}

async function readPrevious(){
  try{return JSON.parse(await fs.readFile(PREVIOUS_FILE,'utf8'));}
  catch{return {schema:1,points:[]};}
}

const now=new Date();
const iso=now.toISOString();
const warsaw=new Intl.DateTimeFormat('pl-PL',{timeZone:'Europe/Warsaw',dateStyle:'short',timeStyle:'medium'}).format(now);

const [goldR,usdR,gcR,eurR,chfR,nbpR,tavexR,stonexR,degussaR,philoroR]=await Promise.all([
  firstOk('XAU/USD',[getGold]),
  firstOk('USD/PLN',[()=>yahoo('USDPLN=X')]),
  firstOk('COMEX GC',[()=>yahoo('GC=F')]),
  firstOk('EUR/PLN',[()=>frankfurter('EUR','PLN')]),
  firstOk('CHF/PLN',[()=>frankfurter('CHF','PLN')]),
  firstOk('NBP gold',[nbpGold]),
  firstOk('Tavex',[tavex]),
  firstOk('StoneX',[stonex]),
  firstOk('Degussa',[degussa]),
  firstOk('philoro',[philoro])
]);

const xau=goldR.value?.price??null;
const usdPln=usdR.value?.price??null;
const eurPln=eurR.value??null;
const chfPln=chfR.value??null;
const plnG=xau>0&&usdPln>0?xau/OZ*usdPln:null;

const dealers={
  tavex:convertDealer(tavexR.value,eurPln,chfPln),
  stonex:convertDealer(stonexR.value,eurPln,chfPln),
  degussa:convertDealer(degussaR.value,eurPln,chfPln),
  philoro:convertDealer(philoroR.value,eurPln,chfPln)
};

const point={
  ts:Date.now(),iso,warsaw,
  market:{
    xauUsd:xau,
    usdPln,
    plnG,
    comexGcUsdOz:gcR.value?.price??null,
    eurPln,
    chfPln,
    nbpGoldPlnG:nbpR.value?.price??null
  },
  dealers:Object.fromEntries(Object.entries(dealers).map(([id,d])=>[id,d?{
    name:d.name,currency:d.currency,nativeSale:d.sale,nativeBuyback:d.buyback,
    salePln:d.salePln,buybackPln:d.buybackPln,url:d.url
  }:null])),
  sourceOk:{
    gold:goldR.ok,usdPln:usdR.ok,comex:gcR.ok,eurPln:eurR.ok,chfPln:chfR.ok,nbpGold:nbpR.ok,
    tavex:tavexR.ok,stonex:stonexR.ok,degussa:degussaR.ok,philoro:philoroR.ok
  }
};

const errors=[goldR,usdR,gcR,eurR,chfR,nbpR,tavexR,stonexR,degussaR,philoroR].filter(x=>!x.ok).map(x=>x.error);
const prev=await readPrevious();
let points=Array.isArray(prev?.points)?prev.points:[];
const last=points.at(-1);
if(last && Math.abs(Number(last.ts)-point.ts)<120000) points[points.length-1]=point;
else points.push(point);
points=points.filter(x=>Number(x?.ts)>Date.now()-8*24*3600*1000).slice(-MAX_POINTS);

const history={schema:1,generatedAt:iso,intervalTargetMinutes:5,points};
const latest={schema:1,generatedAt:iso,point,errors};
const health={schema:1,generatedAt:iso,ok:errors.length===0,errorCount:errors.length,errors,points:points.length,oldest:points[0]?.iso||null,newest:points.at(-1)?.iso||null};

await fs.mkdir(OUT_DIR,{recursive:true});
await Promise.all([
  fs.writeFile(path.join(OUT_DIR,'history.json'),JSON.stringify(history)),
  fs.writeFile(path.join(OUT_DIR,'latest.json'),JSON.stringify(latest,null,2)),
  fs.writeFile(path.join(OUT_DIR,'health.json'),JSON.stringify(health,null,2))
]);

console.log(JSON.stringify({generatedAt:iso,market:point.market,dealers:Object.fromEntries(Object.entries(point.dealers).map(([k,v])=>[k,v?.salePln??null])),errors,points:points.length},null,2));
if(!(xau>0&&usdPln>0&&plnG>0))process.exitCode=2;
