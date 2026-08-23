import { config } from "dotenv";
config({ path: "/Users/kublai/parse-for-agents-live/.env" });
const BASE = "https://www.parsethis.ai";
const master = process.env.MASTER_API_KEY!;
function scrub(v:any,d=0):any{
  if(d>6)return"[depth]";
  if(Array.isArray(v)) return v.slice(0,100).map(x=>scrub(x,d+1));
  if(v&&typeof v==="object"){
    const o:any={};
    for(const [k,val] of Object.entries(v)){
      if(/key|token|secret|authorization|password/i.test(k)&&typeof val==="string"){
        const s=val as string; o[k]=s.startsWith("pfa_")?s.slice(0,8)+"…":s.length>12?s.slice(0,6)+`…len=${s.length}`:"[redacted]";
      } else if(typeof val==="string"&&/^https?:\/\//.test(val)) o[k]=val.split("?")[0]+(val.includes("?")?"?…":"");
      else o[k]=scrub(val,d+1);
    }
    return o;
  }
  return v;
}
async function j(method:string,path:string,body?:any,headers:any={}){
  const res=await fetch(BASE+path,{method,headers:{"content-type":"application/json",Accept:"application/json",...headers},body:body!==undefined?JSON.stringify(body):undefined,redirect:"manual"});
  const text=await res.text(); let b:any=null; try{b=JSON.parse(text);}catch{}
  return {status:res.status,ct:(res.headers.get("content-type")||"").slice(0,80),loc:res.headers.get("location"),title:(text.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]||null,body:scrub(b),text:b?undefined:text.slice(0,300)};
}
async function admin(action:string,params:any={}){
  const res=await fetch(BASE+"/v1/admin/actions",{method:"POST",headers:{Authorization:`Bearer ${master}`,"content-type":"application/json"},body:JSON.stringify({action,params})});
  return {status:res.status,body:scrub(await res.json())};
}
async function main(){
  const out:any={at:new Date().toISOString()};
  // fresh key
  const kgRes=await fetch(BASE+"/v1/keys/generate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:`elon-portal-${Date.now()}`})});
  const kg:any=await kgRes.json();
  const key=kg.key||kg.api_key;
  const auth={Authorization:`Bearer ${key}`};
  out.keygen={status:kgRes.status,scopes:kg.scopes};

  out.keys_self_get=await j("GET","/v1/keys/self",undefined,auth);
  out.keys_self_get_noaccept=await (async()=>{
    const res=await fetch(BASE+"/v1/keys/self",{headers:{Authorization:`Bearer ${key}`}});
    const text=await res.text(); let b:any=null; try{b=JSON.parse(text);}catch{}
    return {status:res.status,ct:res.headers.get("content-type"),body:scrub(b),text:b?undefined:text.slice(0,200)};
  })();
  out.portal_post=await j("POST","/v1/billing/portal",{},auth);
  out.portal_get=await j("GET","/v1/billing/portal",undefined,auth);
  out.portal_post_master=await j("POST","/v1/billing/portal",{}, {Authorization:`Bearer ${master}`});
  out.checkout_solo=await j("POST","/v1/billing/checkout",{tier:"solo"},auth);
  out.usage=await j("GET","/v1/billing/usage",undefined,auth);
  out.billing_dash=await j("GET","/dashboard/billing",undefined,auth);
  out.billing_dash_cookie_like=await j("GET","/dashboard/billing");

  // openapi presence
  const oa=await (await fetch(BASE+"/openapi.json")).json();
  const paths=Object.keys(oa.paths||{});
  out.openapi={
    portal: paths.filter((p:string)=>/portal/i.test(p)),
    keys_self: paths.filter((p:string)=>/keys\/self|keys/i.test(p)).slice(0,20),
    billing: paths.filter((p:string)=>/billing/i.test(p)),
    has_portal: paths.includes("/v1/billing/portal"),
    has_keys_self: paths.includes("/v1/keys/self"),
    has_checkout: paths.includes("/v1/billing/checkout"),
  };

  // llms mentions
  const llms=await (await fetch(BASE+"/llms.txt")).text();
  out.llms={
    portal: llms.split(/\n/).filter(l=>/portal/i.test(l)).slice(0,10),
    keys_self: llms.split(/\n/).filter(l=>/keys\/self|self-revoke|Manage Subscription|billing\/portal/i.test(l)).slice(0,15),
  };

  // full proposal scan without heavy scrub loss - get titles only via repeated list
  const props:any[]=[];
  for(let o=0;o<2000;o+=100){
    const r=await admin("admin.improvement_proposal.list",{limit:100,offset:o});
    const root=r.body?.result??r.body;
    const items=root?.improvement_proposals||[];
    // note: scrub may truncate - request only needed fields by mapping immediately
    for(const p of items){
      props.push({
        id:p.id,
        st:p.status,
        pri:p.priority,
        key:p.idempotency_key,
        title:String(p.title||"").slice(0,160),
        source:p.source,
        created:p.created_at||p.createdAt,
      });
    }
    if(!items.length || items.length<100) break;
  }
  out.prop_count=props.length;
  out.prop_by_status=props.reduce((a:any,p:any)=>{a[p.st||"?"]=(a[p.st||"?"]||0)+1;return a;},{});
  const open=props.filter(p=>!["rejected","done","implemented","completed","closed","shipped"].includes(String(p.st||"").toLowerCase()));
  function m(re:RegExp){return open.filter(p=>re.test(p.title||"")||re.test(p.key||"")).slice(0,12);}
  out.match_portal=m(/portal/i);
  out.match_keys_self=m(/keys\/self|keys_self|self-revoke|GET \/v1\/keys\/self/i);
  out.match_explain=m(/explain/i);
  out.match_paywall=m(/upgradeUrl|paywall|pricing#solo/i);
  out.match_coverage=m(/coverage/i);
  out.match_hold_hash=m(/action_hash|approve_url/i);
  out.match_usage_429=m(/usage.*429|429.*usage|billing\/usage/i);
  out.match_checkout_field=m(/checkout_url|field-split|\{url\}/i);
  out.open_count=open.length;

  // revoke
  out.revoke=await j("DELETE","/v1/keys/self",undefined,auth);
  console.log(JSON.stringify(out,null,2));
}
main().catch(e=>{console.error(String(e).slice(0,400));process.exit(1);});
