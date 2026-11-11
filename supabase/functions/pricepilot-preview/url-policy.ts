/** Public product page URL validation for best-effort extraction.
 * No redirects; do not fetch IP literals, internal hostnames, or credentialed URLs.
 * DNS rebinding protection needs a production egress proxy before scaling.
 */
export function validateProductUrl(raw:string):URL|null {
 try{
  if(raw.length>2048||/[\u0000-\u0020\u007f]/.test(raw))return null;
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.username||u.password||u.port)return null;
  u.hash='';
  const host=u.hostname.toLowerCase().replace(/\.$/,'');
  if(host!==u.hostname.toLowerCase())return null;
  if(host.length>253||!host.includes('.')||host.includes('..'))return null;
  if(!/^[a-z0-9.-]+$/.test(host))return null;
  if(host.split('.').some(label=>!label||label.length>63||label.startsWith('-')||label.endsWith('-')))return null;
  if(/^(?:\d+\.){3}\d+$/.test(host)||/^\d+$/.test(host))return null;
  if(/\b(?:localhost|local|internal|intranet|lan|home|test|invalid|example|onion|arpa)$/.test(host))return null;
  if(/(?:^|\.)(?:nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me|traefik\.me|localhost\.direct|amazonaws\.com|cloudfront\.net|azurewebsites\.net|googleapis\.com|internal|metadata\.google\.internal|supabase\.co|github\.io)$/.test(host))return null;
  if(['169.254.169.254','metadata.google.internal','metadata.azure.internal'].includes(host))return null;
  return u;
 }catch{return null}
}

/** DNS preflight: reject hosts whose public records resolve to private or reserved IPs.
 * Note: normal fetch() does not pin DNS results; hardened egress is required at scale.
 */
export function isPublicIpv4(ip:string):boolean{
 const parts=ip.split('.');
 if(parts.length!==4||parts.some(x=>!/^\d{1,3}$/.test(x)||Number(x)>255))return false;
 const [a,b,c]=parts.map(Number);
 if(a===0||a===10||a===127||a>=224)return false;
 if(a===100&&b>=64&&b<=127)return false;
 if(a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168)return false;
 if(a===192&&b===0&&c===0||a===192&&b===0&&c===2||a===192&&b===88&&c===99)return false;
 if(a===198&&(b===18||b===19)||a===198&&b===51&&c===100||a===203&&b===0&&c===113)return false;
 return true;
}
export function isPublicIpv6(ip:string):boolean {
 const v=ip.toLowerCase();
 if(!/^[0-9a-f:.]+$/.test(v))return false;
 if(v.includes('.')){
  const embedded=v.split(':').pop()||'';
  return isPublicIpv4(embedded)&&!v.startsWith('::ffff:');
 }
 if(v==='::'||v==='::1'||v.startsWith('fc')||v.startsWith('fd')||v.startsWith('fe8')||v.startsWith('fe9')||v.startsWith('fea')||v.startsWith('feb'))return false;
 if(v.startsWith('2001:db8:')||v==='2001:db8::')return false;
 if(v.startsWith('ff')||v.startsWith('::ffff:')||v.startsWith('2002:')||v.startsWith('64:ff9b:'))return false;
 return true;
}
export async function hasPublicDnsRecords(hostname:string):Promise<boolean> {
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),3500);
 try {
  const replies=await Promise.all([1,28].map(async type=>{
   const u=new URL('https://dns.google/resolve');
   u.searchParams.set('name',hostname);
   u.searchParams.set('type',String(type));
   const res=await fetch(u.href,{redirect:'error',signal:controller.signal,headers:{accept:'application/dns-json'}});
   if(!res.ok)throw Error('DNS lookup unavailable');
   const data=await res.json();
   if(![0,3].includes(data.Status))throw Error('Unexpected DNS status');
   return (data.Answer||[]).filter((x:{type:number})=>x.type===type).map((x:{data:string})=>x.data);
  }));
  const [v4,v6]=replies;
  if(!v4.length&&!v6.length)return false;
  return v4.every(isPublicIpv4)&&v6.every(isPublicIpv6);
 }catch{return false}
 finally{clearTimeout(timer)}
}
