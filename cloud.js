import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const url='https://sfuoimxxzezzovqsigev.supabase.co';
const key='sb_publishable_5y1JZtbE9V_EcRrkGN1M4Q__1qPpZW0';
const client=createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=s=>document.querySelector(s);
const button=$('#accountBtn'),modal=$('#accountOverlay'),form=$('#accountForm'),message=$('#accountMsg');
let user=null,snapshot=new Map(),queue=Promise.resolve(),syncTimer,loading=false;
const info=s=>{message.textContent=s;message.hidden=!s};
const notify=s=>typeof window.pricepilotToast==='function'?window.pricepilotToast(s):info(s);
const shape=x=>({id:x.id,url:x.url,name:x.name,target:Number(x.target),currency:x.currency,size:x.size||'',color:x.color||'',stock:!!x.stock,buy:!!x.buy,price:x.price??null,available:x.available??null,checked:x.checked??null});
const toDb=x=>({...shape(x),user_id:user.id});
const fromDb=x=>shape(x);
const value=x=>JSON.stringify(shape(x));
function setAccountButton(){button.textContent=user?'◉ '+(user.email||'Account').split('@')[0]:'◎ Sign in';button.title=user?'Account and cloud sync':'Sign in to save trackers to the cloud';$('#cloudState').textContent=user?'● Cloud watchlist':'● Guest watchlist'}
function guestData(){try{return JSON.parse(localStorage.getItem('pricepilot-v1'))||{items:[],events:[],settings:{api:'',token:'',email:''}}}catch{return{items:[],events:[],settings:{api:'',token:'',email:''}}}}
async function hydrate(u){
 loading=true;window.PricePilotCloudReady=false;window.PricePilotAccountKey='pricepilot-user-'+u.id;
 const {data,error}=await client.from('pricepilot_trackers').select('*').order('created_at',{ascending:false});
 if(error){loading=false;window.pricepilotSwitchData({items:[],events:[],settings:{api:'',token:'',email:''}});$('#cloudState').textContent='● Cloud unavailable';notify('Could not load cloud watchlist: '+error.message);return}
 const items=data.map(fromDb);snapshot=new Map(items.map(x=>[x.id,value(x)]));
 window.pricepilotSwitchData({items,events:[],settings:{api:'',token:'',email:''}});
 loading=false;window.PricePilotCloudReady=true;
 setAccountButton();notify('Signed in. Your watchlist is saved in Supabase.');
}
async function authState(event,session){
 const next=session?.user||null;
 if(next?.id===user?.id)return;
 user=next;window.PricePilotCloudReady=false;clearTimeout(syncTimer);
 if(!user){window.PricePilotAccountKey=null;snapshot.clear();window.pricepilotSwitchData(guestData());setAccountButton();return}
 setAccountButton();await hydrate(user);
}
client.auth.onAuthStateChange((event,session)=>{setTimeout(()=>authState(event,session),0)});
client.auth.getSession().then(({data})=>authState('INITIAL_SESSION',data.session)).catch(e=>notify('Authentication unavailable: '+e.message));
async function flush(){
 if(!user||loading||!window.PricePilotCloudReady)return;
 const uid=user.id,items=window.pricepilotState().items.map(shape);
 // Serialize sync batches. RLS and the database quota remain authoritative.
 queue=queue.then(async()=>{
  if(!user||user.id!==uid)return;
  const active=new Set(items.map(x=>x.id));
  for(const [id] of snapshot){if(active.has(id))continue;
   const {error}=await client.from('pricepilot_trackers').delete().eq('id',id);
   if(error)throw error;snapshot.delete(id);
  }
  for(const item of items){if(snapshot.get(item.id)===value(item))continue;
   const {error}=await client.from('pricepilot_trackers').upsert({...item,user_id:uid},{onConflict:'id'});
   if(error)throw error;snapshot.set(item.id,value(item));
  }
 }).then(()=>{if(user?.id===uid)$('#cloudState').textContent='● Cloud synchronized'}).catch(e=>{$('#cloudState').textContent='● Sync failed';notify('Cloud sync failed: '+e.message);console.error('PricePilot cloud sync',e)});
 await queue;
}
document.addEventListener('pricepilot:data',()=>{if(!user||loading)return;clearTimeout(syncTimer);syncTimer=setTimeout(flush,500)});
window.pricepilotCloudSaveNow=flush;
button.addEventListener('click',()=>{modal.classList.remove('hidden');info(user?'Signed in as '+user.email:'Sign in or create a free account.');$('#accountEmail').value=user?.email||'';$('#accountSignOut').hidden=!user;form.hidden=!!user;$('#accountImport').hidden=!user});
$('#accountClose').addEventListener('click',()=>modal.classList.add('hidden'));
modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.add('hidden')});
form.addEventListener('submit',async e=>{
 e.preventDefault();const email=$('#accountEmail').value.trim(),password=$('#accountPassword').value;
 const action=e.submitter?.value||'signin';
 if(!email||password.length<8){info('Use a valid email and a password of at least 8 characters.');return}
 info('Connecting securely…');
 const {data,error}=action==='signup'?await client.auth.signUp({email,password,options:{emailRedirectTo:'https://zairiedu.github.io/pricetracker/'}}):await client.auth.signInWithPassword({email,password});
 if(error)return info(error.message);
 if(action==='signup'&&!data.session)info('Account created. Confirm your email using the link sent by Supabase, then sign in.');
 else{info('Signed in successfully.');$('#accountPassword').value='';modal.classList.add('hidden')}
});
$('#accountSignOut').addEventListener('click',async()=>{await flush();const {error}=await client.auth.signOut();if(error)info(error.message);else{modal.classList.add('hidden');notify('Signed out. Guest data is separate.')}});
$('#accountImport').addEventListener('click',async()=>{
 if(!user)return;
 const guest=guestData().items||[],current=window.pricepilotState().items;
 const selected=guest.filter(x=>!current.some(y=>y.url===x.url&&y.size===x.size&&y.color===x.color)).slice(0,Math.max(0,5-current.length));
 if(!selected.length)return info('No guest trackers available, or your free-plan limit is reached.');
 if(!confirm('Import '+selected.length+' guest tracker(s) into this account? Guest copies will remain on this device.'))return;
 for(const x of selected){
  const next=shape(x),{error}=await client.from('pricepilot_trackers').upsert({...next,user_id:user.id},{onConflict:'id'});
  if(error){info('Import stopped: '+error.message);return}
 }
 await hydrate(user);info('Guest trackers imported.');modal.classList.add('hidden');
});
