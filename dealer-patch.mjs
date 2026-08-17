import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR=process.env.OUT_DIR||'/tmp/gold-pilot-out';
const UA='Mozilla/5.0 (GoldPilotCloud dealer patch/1.0)';

function n(v){
  if(v===null||v===undefined)return null;
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  let s=String(v).trim().replace(/\u00a0/g,' ').replace(/[’']/g,'').replace(/[^0-9,.-]/g,'');
  if(!s)return null;
  const ci=s.lastIndexOf(','),di=s.lastIndexOf('.');
  if(ci>=0&&di>=0)s=di>ci?s.replace(/,/g,''):s.replace(/\./g,'').replace(',','.');
  else if(ci>=0)s=(s.length-ci-1===2)?s.replace(',','.'):s.replace(/,/g,'');
  const x=Number(s);return Number.isFinite(x)?x:null;
}

async function text(url,timeout=12000){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(url,{headers:{'user-agent':UA},signal:c.signal,redirect:'follow'});if(!r.ok)throw new Error(String(r.status));return await r.text();}
  finally{clearTimeout(t);}
}

function strip(s=''){return String(s).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&euro;/gi,'€').replace(/\s+/g,' ').trim();}

async function candidates(url){
  const out=[];
  for(const [kind,u] of [['reader','https://r.jina.ai/'+url],['direct',url]]){
    try{const raw=await text(u);out.push(kind==='reader'?raw:strip(raw));}catch{}
  }
  return out;
}

function parseStoneX(t){
  const sale=(t.match(/#?\s*10g Gold Bar\s*\|\s*Argor-Heraeus[\s\S]{0,180}?€\s*([\d,.]+)/i)||t.match(/€\s*([\d,.]+)\s*\|\s*Gross incl\. VAT/i));
  const buy=t.match(/(?:####\s*)?Buy back[\s\S]{0,140}?€\s*([\d,.]+)/i);
  const s=n(sale?.[1]),b=n(buy?.[1]);
  return s>=200&&s<=5000?{sale:s,buyback:b>=200&&b<=5000?b:null}:null;
}

function parseTavex(t){
  const sale=t.match(/Aktualna cena sprzedaży 1 szt\.?[\s\S]{0,80}?([\d\s.,]+)\s*zł/i)
    ||t.match(/Sprzedaż\s+Skup\s+Spread[\s\S]{0,80}?1-2[\s\S]{0,40}?([\d\s.,]+)\s*zł/i);
  const buy=t.match(/Aktualna cena skupu 1 szt\.?[\s\S]{0,80}?([\d\s.,]+)\s*zł/i)
    ||t.match(/Sprzedaż\s+Skup\s+Spread[\s\S]{0,100}?1-2[\s\S]{0,60}?[\d\s.,]+\s*zł[\s\n]+([\d\s.,]+)\s*zł/i);
  const s=n(sale?.[1]),b=n(buy?.[1]);
  return s>=1000&&s<=20000?{sale:s,buyback:b>=1000&&b<=20000?b:null}:null;
}

const latestPath=path.join(OUT_DIR,'latest.json');
const historyPath=path.join(OUT_DIR,'history.json');
const healthPath=path.join(OUT_DIR,'health.json');
const latest=JSON.parse(await fs.readFile(latestPath,'utf8'));
const history=JSON.parse(await fs.readFile(historyPath,'utf8'));

const eur=n(latest?.point?.market?.eurPln),chf=n(latest?.point?.market?.chfPln);
let fixedStone=false,fixedTavex=false;

for(const t of await candidates('https://stonexbullion.com/en/gold-bars/10g/10g-gold-bar-argor-heraeus/')){
  const p=parseStoneX(t);if(!p)continue;
  latest.point.dealers.stonex={name:'StoneX Bullion',currency:'EUR',nativeSale:p.sale,nativeBuyback:p.buyback,salePln:eur>0?p.sale*eur:null,buybackPln:eur>0&&p.buyback>0?p.buyback*eur:null,url:'https://stonexbullion.com/en/gold-bars/10g/10g-gold-bar-argor-heraeus/'};
  latest.point.sourceOk.stonex=true;fixedStone=true;break;
}

for(const t of await candidates('https://tavex.pl/zloto/zlota-sztabka-argor-heraeus-10-g/')){
  const p=parseTavex(t);if(!p)continue;
  latest.point.dealers.tavex={name:'Tavex Polska',currency:'PLN',nativeSale:p.sale,nativeBuyback:p.buyback,salePln:p.sale,buybackPln:p.buyback,url:'https://tavex.pl/zloto/zlota-sztabka-argor-heraeus-10-g/'};
  latest.point.sourceOk.tavex=true;fixedTavex=true;break;
}

if(fixedStone)latest.errors=(latest.errors||[]).filter(x=>!String(x).startsWith('StoneX:'));
if(fixedTavex)latest.errors=(latest.errors||[]).filter(x=>!String(x).startsWith('Tavex:'));

const pts=Array.isArray(history.points)?history.points:[];
if(pts.length){
  const i=pts.length-1;
  if(fixedStone){pts[i].dealers.stonex=latest.point.dealers.stonex;pts[i].sourceOk.stonex=true;}
  if(fixedTavex){pts[i].dealers.tavex=latest.point.dealers.tavex;pts[i].sourceOk.tavex=true;}
}
history.generatedAt=latest.generatedAt;

const health={schema:1,generatedAt:latest.generatedAt,ok:(latest.errors||[]).length===0,errorCount:(latest.errors||[]).length,errors:latest.errors||[],points:pts.length,oldest:pts[0]?.iso||null,newest:pts.at(-1)?.iso||null};

await Promise.all([
  fs.writeFile(latestPath,JSON.stringify(latest,null,2)),
  fs.writeFile(historyPath,JSON.stringify(history)),
  fs.writeFile(healthPath,JSON.stringify(health,null,2))
]);
console.log(JSON.stringify({dealerPatch:{stonex:fixedStone,tavex:fixedTavex},stoneX:latest.point.dealers.stonex?.salePln??null,tavexBuyback:latest.point.dealers.tavex?.buybackPln??null,errors:latest.errors},null,2));
