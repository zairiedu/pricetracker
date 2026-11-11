import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
import { parse } from 'npm:node-html-parser@9.0.7';

const ORIGIN = 'https://zairiedu.github.io';
const headers = {'content-type':'application/json','access-control-allow-origin':ORIGIN,'vary':'Origin','cache-control':'no-store'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const allowedHosts = new Set(['bestbuy.ca','www.bestbuy.ca','walmart.ca','www.walmart.ca','canadiantire.ca','www.canadiantire.ca','sportchek.ca','www.sportchek.ca']);
function validRetailerUrl(raw:string):URL|null {
 try {
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!allowedHosts.has(u.hostname.toLowerCase()))return null;
  return u;
 }catch{return null}
}
function extractOffer(html:string,requiredSize:string,requiredColor:string,currency:string){
 const scripts=[...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
 for(const script of scripts){
  let parsed:unknown;
  try{parsed=JSON.parse(script[1]);}catch{continue;}
  const products:Record<string,unknown>[]=[];
  function scan(node:unknown,depth=0){
   if(depth>8||!node||typeof node!=='object')return;
   if(Array.isArray(node)){for(const entry of node)scan(entry,depth+1);return}
   const item=node as Record<string,unknown>;
   const typ=item['@type'];
   if(typ==='Product'||Array.isArray(typ)&&typ.includes('Product'))products.push(item);
   if(item['@graph'])scan(item['@graph'],depth+1);
  }
  scan(parsed);
  for(const product of products){
   const normalized=(v:unknown)=>String(v??'').trim().toLowerCase();
   if(requiredSize&&normalized(product.size)!==normalized(requiredSize))continue;
   if(requiredColor&&normalized(product.color)!==normalized(requiredColor))continue;
   const offers=Array.isArray(product.offers)?product.offers:[product.offers];
   for(const item of offers){
    if(!item||typeof item!=='object')continue;
    const offer=item as Record<string,unknown>;
    const details=offer.priceSpecification&&typeof offer.priceSpecification==='object'?offer.priceSpecification as Record<string,unknown>:{};
    const amount=Number(offer.price??offer.lowPrice??details.price);
    const offerCurrency=String(offer.priceCurrency??details.priceCurrency??'').toUpperCase();
    const rawAvailability=String(offer.availability??'').toLowerCase();
    if(!Number.isFinite(amount)||amount<0||amount>10000000||offerCurrency!==currency)continue;
    const available=rawAvailability.endsWith('/instock')||rawAvailability.endsWith('#instock')?true:rawAvailability.includes('outofstock')?false:null;
    return {amount,available};
   }
  }
 }
 return null;
}
async function limitedHtml(url:string){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8500);
 try{
  const response=await fetch(url,{redirect:'manual',signal:controller.signal,headers:{'accept':'text/html','user-agent':'PricePilot/0.2 (price availability preview)'}});
  if(!response.ok)throw Error('Retailer declined request ('+response.status+')');
  if(!(response.headers.get('content-type')??'').toLowerCase().includes('text/html'))throw Error('Retailer returned non-HTML data');
  if(Number(response.headers.get('content-length')||0)>1100000)throw Error('Retailer response too large');
  if(!response.body)throw Error('Empty response');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let total=0;
  while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>1100000){await reader.cancel();throw Error('Retailer response too large')}parts.push(value)}
  const all=new Uint8Array(total);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.byteLength}
  return new TextDecoder().decode(all);
 }finally{clearTimeout(timer)}
}


/** Generic ecommerce metadata extraction. Never infer a price from unrelated recommendation cards. */
function clean(value:unknown,max=120):string|null {
 if(typeof value!=='string')return null;
 const normalized=value.replace(/[\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim();
 return normalized?normalized.slice(0,max):null;
}
function parseProduct(html:string, productUrl:string){
 const root=parse(html);
 const allMeta=root.querySelectorAll('meta');
 const meta=(...names:string[]):string|null=>{
  for(const name of names){
   const node=allMeta.find(e=>(e.getAttribute('property')||e.getAttribute('name')||e.getAttribute('itemprop')||'').toLowerCase()===name.toLowerCase());
   const value=node?.getAttribute('content');if(value)return clean(value,260);
  }
  return null;
 };
 const products:Record<string,unknown>[]=[];
 function gather(node:unknown,depth=0){
  if(depth>12||!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const item of node)gather(item,depth+1);return}
  const obj=node as Record<string,unknown>;
  const typ=obj['@type'];const types=Array.isArray(typ)?typ:[typ];
  if(types.some(t=>typeof t==='string'&&t.toLowerCase().split('/').pop()==='product'))products.push(obj);
  if(obj['@graph'])gather(obj['@graph'],depth+1);
  if(obj.mainEntity)gather(obj.mainEntity,depth+1);
 };
 for(const script of root.querySelectorAll('script[type]')){
  if((script.getAttribute('type')||'').toLowerCase()!=='application/ld+json')continue;
  try{gather(JSON.parse(script.text))}catch{/* Ignore malformed metadata blocks */ }
 }
 const expected=decodeURIComponent(new URL(productUrl).pathname.toLowerCase());
 const productId=expected.match(/(\d{7,12})p?\.html?$/)?.[1]||null;
 const productScore=(p:Record<string,unknown>)=>{
  const name=clean(p.name);if(!name)return -100;
  let score=1;
  const url=typeof p.url==='string'?p.url:null;
  if(url){try{const u=new URL(url,productUrl);if(u.pathname.toLowerCase()===expected)score+=10;else if(u.hostname!==new URL(productUrl).hostname)score-=3}catch{}}
  const identifiers=[p.sku,p.productID,p.mpn].map(x=>String(x??'').replace(/\D/g,''));
  if(productId&&identifiers.some(x=>x.includes(productId)))score+=8;
  if(expected.split('/').some(segment=>segment.includes(name.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,22))))score+=3;
  return score;
 };
 products.sort((a,b)=>productScore(b)-productScore(a));
 const product=products[0]&&productScore(products[0])>0?products[0]:null;
 const nameFromProduct=clean(product?.name);
 const title=clean(root.querySelector('title')?.text,200)?.replace(/\s+[|–-]\s+(Canadian Tire|Walmart|Sport Chek|Best Buy).*$/i,'');
 const name=nameFromProduct||meta('og:title','twitter:title')||title||clean(root.querySelector('h1')?.text);
 const brand=typeof product?.brand==='string'?clean(product.brand,80):product?.brand&&typeof product.brand==='object'?clean((product.brand as Record<string,unknown>).name,80):meta('product:brand','brand');
 const size=clean(product?.size,40),color=clean(product?.color,40)||meta('product:color');
 const description=clean(product?.description,400)||meta('og:description','description');
 const sku=clean(product?.sku,80)||clean(product?.productID,80)||meta('product:retailer_item_id');
 const imageRaw=typeof product?.image==='string'?product.image:Array.isArray(product?.image)?product.image[0]:typeof product?.image==='object'?((product.image as Record<string,unknown>)?.url):null;
 const maybeImage=clean(imageRaw,1500)||meta('og:image','twitter:image');
 let image:string|null=null;try{if(maybeImage){const u=new URL(maybeImage,productUrl);if(u.protocol==='https:')image=u.href}}catch{}
 const offers=product?.offers;
 const offerList=Array.isArray(offers)?offers:[offers];
 const choosePrice=(amount:unknown,curr:unknown)=>{
  if(amount===null||amount===undefined||amount==='')return null;
  const numeric=Number(String(amount).replace(/,/g,''));
  const currency=String(curr||'').toUpperCase();
  return Number.isFinite(numeric)&&numeric>=0&&numeric<=10000000&&['CAD','USD','EUR','GBP'].includes(currency)?{price:numeric,currency}:null;
 };
 let price:null|number=null,currency:null|string=null,available:null|boolean=null;
 let source='product_title';
 for(const o of offerList){
  if(!o||typeof o!=='object')continue;
  const offer=o as Record<string,unknown>;
  const spec=offer.priceSpecification&&typeof offer.priceSpecification==='object'?offer.priceSpecification as Record<string,unknown>:{};
  const found=choosePrice(offer.price??spec.price,offer.priceCurrency??spec.priceCurrency);
  if(!found)continue;
  price=found.price;currency=found.currency;source='jsonld_offer';
  const raw=String(offer.availability??'').toLowerCase();
  available=raw.endsWith('/instock')||raw.endsWith('#instock')?true:raw.includes('outofstock')?false:null;
  break;
 }
 if(price===null){
  const found=choosePrice(meta('product:price:amount','og:price:amount','price'),meta('product:price:currency','og:price:currency','priceCurrency'));
  if(found){price=found.price;currency=found.currency;source='page_price_metadata'}
 }
 if(source==='product_title'&&nameFromProduct)source='jsonld_product';
 if(source==='product_title'&&meta('og:title','twitter:title'))source='page_metadata';
 return {name,brand,size,color,description,sku,image,price,currency,available,source,
  priceVerified:false,warning:'Page preview only. Price and availability might vary by store, region or variant. No checkout or verified price alerts are triggered by this value.'};
}

Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info,x-supabase-api-version'}});
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(request.headers.get('origin')&&request.headers.get('origin')!==ORIGIN)return json({error:'Origin not supported'},403);
 const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
 if(!token)return json({error:'Please sign in to fetch product details'},401);
 const endpoint=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!endpoint||!anon||!secret)return json({error:'Service unavailable'},503);
 const idClient=createClient(endpoint,anon,{auth:{persistSession:false}});
 const {data:{user},error:userError}=await idClient.auth.getUser(token);
 if(userError||!user||user.is_anonymous)return json({error:'Authentication required'},401);
 let body:unknown;try{body=await request.json()}catch{return json({error:'Invalid request'},400)}
 const raw=(body as {url?:unknown})?.url;
 if(typeof raw!=='string'||raw.length>2048)return json({error:'Product URL required'},400);
 const site=validRetailerUrl(raw);
 if(!site)return json({error:'Auto-fill currently supports select Canadian retailers (including Sport Chek). You can still enter details manually.'},422);
 const db=createClient(endpoint,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const {count,error:countError}=await db.from('pricepilot_product_previews').select('id',{head:true,count:'exact'}).eq('user_id',user.id).gte('created_at',new Date(Date.now()-86400000).toISOString());
 if(countError)return json({error:'Preview service unavailable'},503);
 if((count??0)>=25)return json({error:'Daily preview limit reached. Try again later.'},429);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(site.href)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const {error:claimError}=await db.from('pricepilot_product_previews').insert({user_id:user.id,url_hash:hash,window_slot:Math.floor(Date.now()/300000)});
 if(claimError)return json({error:claimError.code==='23505'?'Wait five minutes before previewing this URL again.':'Preview unavailable'},claimError.code==='23505'?429:503);
 try{
  const details=parseProduct(await limitedHtml(site.href),site.href);
  if(!details.name&&!details.price)return json({error:'The retailer did not provide usable product metadata. Please fill the fields manually.'},422);
  return json({success:true,...details,checkedAt:new Date().toISOString(),warning:'Price is a page preview, not a verified observation for the selected variant. Confirm size, color, price, and target before saving.'});
 }catch(e){return json({error:'Could not fetch retailer details: '+String((e as Error).message).slice(0,160)},422)}
});
