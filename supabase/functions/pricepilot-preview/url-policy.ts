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
