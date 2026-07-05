"use strict";
const now=()=>new Date().toISOString();
const today=()=>new Date().toISOString().slice(0,10);
const val=id=>document.getElementById(id).value;
const esc=s=>String(s??"").replace(/[<>&"]/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;"}[c]));
const kv=(k,v)=>`<div class="row"><span class="k">${k}</span>${v}</div>`;
const coerceStr=v=>typeof v==="string"?v:(v==null?"":String(v));
const coerceBool=v=>v===true||v==="true";
const coerceArr=v=>Array.isArray(v)?v:[];
const coerceNum=(v,def,min,max)=>{const n=Number(v);if(!Number.isFinite(n))return def;return Math.min(max,Math.max(min,n));};

/* ============ 枚举 ============ */
const REL_TYPES=[
 ["synonym","近义"],["root_related","词根相关"],["prefix_derivation","前缀派生"],
 ["formal_register","正式程度"],["topic_member","属于专题"],["confusion","易混淆"],
 ["collocation","固定搭配"],["antonym","反义"],["semantic_related","语义相关"],["chinese_overlap","中文近似"]
];
const VALID_REL_TYPES=REL_TYPES.map(r=>r[0]);
const VALID_LEVELS=["A1","A2","B1","B2"];
const VALID_POS=["Verb","Nomen","Adjektiv","Adverb","Präposition","Konjunktion","Pronomen","Artikel",""];
const VALID_AUX=["haben","sein",""];
const VALID_DIRECTION=["directed","undirected"];
const STATUS_ORDER=["raw","explained","topic_only","linked","compared","complete"];
const STATUS_LABEL={raw:"未整理",explained:"已解释",topic_only:"已归类",linked:"已连接",compared:"已写区别",complete:"整理完成"};
const STATUS_COLOR_DARK={raw:"#d44a4a",explained:"#4a9fd4",topic_only:"#a06ad4",linked:"#d4914a",compared:"#d4c44a",complete:"#4ac47f"};
const STATUS_COLOR_LIGHT={raw:"#d64545",explained:"#2f7dc0",topic_only:"#8a52c0",linked:"#c07a2f",compared:"#b7911f",complete:"#2f9e5f"};
function statusColorMap(){return currentTheme()==="light"?STATUS_COLOR_LIGHT:STATUS_COLOR_DARK;}
const STATUS_COLOR=STATUS_COLOR_DARK;

/* ============ 主题 ============ */
function currentTheme(){return document.documentElement.getAttribute("data-theme")||"dark";}
function applyTheme(t){
  document.documentElement.setAttribute("data-theme",t);
  localStorage.setItem("vocab_theme",t);
  const btn=document.getElementById("theme-toggle");
  if(btn)btn.textContent=t==="light"?"☀ 浅色":"🌙 深色";
}
function initTheme(){
  const saved=localStorage.getItem("vocab_theme")||"dark";
  applyTheme(saved);
  const btn=document.getElementById("theme-toggle");
  if(btn)btn.onclick=()=>{
    const next=currentTheme()==="light"?"dark":"light";
    applyTheme(next);
    const gp=document.getElementById("page-graph");
    if(gp&&gp.classList.contains("active"))renderGraph();
  };
}

/* ============ slug ID ============ */
const POS_SLUG={"Verb":"verb","Nomen":"nomen","Adjektiv":"adjektiv","Adverb":"adverb","":"x"};
function translit(s){
  return coerceStr(s)
    .replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue")
    .replace(/Ä/g,"ae").replace(/Ö/g,"oe").replace(/Ü/g,"ue").replace(/ß/g,"ss")
    .toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
}
function uniquify(base,existing){
  if(!existing.has(base)){existing.add(base);return base;}
  let i=2;while(existing.has(base+"_"+i))i++;
  const id=base+"_"+i;existing.add(id);return id;
}
const makeWordSlug=(word,pos,ex)=>uniquify("word_"+translit(word)+"_"+(POS_SLUG[pos]||translit(pos)||"x"),ex);
const makeTopicSlug=(name,ex)=>uniquify("topic_"+translit(name),ex);
const makeConfusionSlug=(name,ex)=>uniquify("confusion_"+translit(name),ex);
const makeEdgeSlug=(from,to,type,ex)=>uniquify("edge_"+from.replace(/^word_/,"")+"__"+to.replace(/^word_/,"")+"__"+type,ex);

/* ============ storage 层 ============ */
const storage=(()=>{
  const KEY="german_vocab_map_v1";
  return {
    load(){const raw=localStorage.getItem(KEY);if(raw===null)return null;try{return JSON.parse(raw);}catch(e){console.error("storage.load",e);return null;}},
    save(db){localStorage.setItem(KEY,JSON.stringify(db));},
    export(db){const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`german-vocab-backup-${today()}.json`;a.click();URL.revokeObjectURL(url);},
    import(text){let parsed;try{parsed=JSON.parse(text);}catch(e){return{ok:false,error:"JSON 解析失败: "+e.message};}return sanitizeAndMigrate(parsed);},
    clear(){localStorage.removeItem(KEY);}
  };
})();

/* ============ 单词默认模板 ============ */
function wordDefaults(){
  const t=now();
  return {id:"",word:"",lemma:"",pos:"",article:"",plural:"",level:"B1",source:"import",
    meaning_cn:"",meaning_en:"",is_key:false,needs_contrast:false,tags:[],topic_ids:[],
    example_de:"",example_cn:"",note:"",
    separable:false,prefix:"",past_participle:"",preterite:"",auxiliary:"",case_or_preposition:"",collocations:[],
    created_at:t,updated_at:t};
}

/* ============ 校验 + 清洗 + ID 迁移 ============ */
function sanitizeAndMigrate(raw){
  const report={fixed:[],dropped:[],remapped:0,version:raw&&raw.version};
  if(!raw||typeof raw!=="object")return{ok:false,error:"顶层不是对象"};
  if(!Array.isArray(raw.words))return{ok:false,error:"缺少 words 数组，非本工具备份"};
  const usedIds=new Set();
  const wordIdMap={},topicIdMap={};
  const topics=[];
  coerceArr(raw.topics).forEach(t=>{
    if(!t||!coerceStr(t.name_de).trim()){report.dropped.push("topic(无 name_de)");return;}
    const oldId=coerceStr(t.id);
    const newId=makeTopicSlug(t.name_de,usedIds);
    if(oldId)topicIdMap[oldId]=newId;
    let level=coerceStr(t.level);
    if(!VALID_LEVELS.includes(level)){level="B1";report.fixed.push(`topic ${newId} level→B1`);}
    topics.push({id:newId,name_de:coerceStr(t.name_de).trim(),name_cn:coerceStr(t.name_cn),description:coerceStr(t.description),
      parent_topic:coerceStr(t.parent_topic)||null,level,tags:coerceArr(t.tags).map(coerceStr),
      created_at:coerceStr(t.created_at)||now(),updated_at:now()});
  });
  topics.forEach(t=>{if(t.parent_topic){if(topicIdMap[t.parent_topic])t.parent_topic=topicIdMap[t.parent_topic];else if(!topics.some(x=>x.id===t.parent_topic)){report.fixed.push(`topic ${t.id} parent 失效→清空`);t.parent_topic=null;}}});
  const words=[];
  coerceArr(raw.words).forEach(w=>{
    if(!w||!coerceStr(w.word).trim()){report.dropped.push("word(无 word)");return;}
    const d=wordDefaults();
    const oldId=coerceStr(w.id);
    let pos=coerceStr(w.pos);
    if(!VALID_POS.includes(pos))report.fixed.push(`word "${w.word}" pos "${pos}" 非标准→保留`);
    const newId=makeWordSlug(w.word,pos,usedIds);
    if(oldId)wordIdMap[oldId]=newId;
    let level=coerceStr(w.level);
    if(!VALID_LEVELS.includes(level)){level="B1";report.fixed.push(`word "${w.word}" level→B1`);}
    let aux=coerceStr(w.auxiliary);if(!VALID_AUX.includes(aux))aux="";
    words.push(Object.assign(d,{
      id:newId,word:coerceStr(w.word).trim(),lemma:coerceStr(w.lemma).trim()||coerceStr(w.word).trim(),
      pos,article:coerceStr(w.article),plural:coerceStr(w.plural),level,source:coerceStr(w.source)||"import",
      meaning_cn:coerceStr(w.meaning_cn),meaning_en:coerceStr(w.meaning_en),
      is_key:coerceBool(w.is_key),needs_contrast:coerceBool(w.needs_contrast),
      tags:coerceArr(w.tags).map(coerceStr),topic_ids:coerceArr(w.topic_ids).map(coerceStr),
      example_de:coerceStr(w.example_de),example_cn:coerceStr(w.example_cn),note:coerceStr(w.note),
      separable:coerceBool(w.separable),prefix:coerceStr(w.prefix),past_participle:coerceStr(w.past_participle),
      preterite:coerceStr(w.preterite),auxiliary:aux,case_or_preposition:coerceStr(w.case_or_preposition),
      collocations:coerceArr(w.collocations).map(coerceStr),
      created_at:coerceStr(w.created_at)||now(),updated_at:now()
    }));
  });
  const topicIds=new Set(topics.map(t=>t.id));
  words.forEach(w=>{w.topic_ids=w.topic_ids.map(tid=>topicIdMap[tid]||tid).filter(tid=>{if(topicIds.has(tid))return true;report.fixed.push(`word ${w.id} topic_id ${tid} 失效→移除`);return false;});});
  const wordIds=new Set(words.map(w=>w.id));
  const edges=[];const edgeIdSet=new Set();
  coerceArr(raw.edges).forEach(e=>{
    if(!e)return;
    const from=wordIdMap[coerceStr(e.from)]||coerceStr(e.from);
    const to=wordIdMap[coerceStr(e.to)]||coerceStr(e.to);
    if(!wordIds.has(from)){report.dropped.push(`edge(from 无对应 word: ${e.from})`);return;}
    if(!wordIds.has(to)){report.dropped.push(`edge(to 无对应 word: ${e.to})`);return;}
    if(from===to){report.dropped.push(`edge(自环: ${from})`);return;}
    let type=coerceStr(e.type);
    if(!VALID_REL_TYPES.includes(type)){type="semantic_related";report.fixed.push(`edge ${from}->${to} type→semantic_related`);}
    let dir=coerceStr(e.direction);if(!VALID_DIRECTION.includes(dir))dir="directed";
    edges.push({id:makeEdgeSlug(from,to,type,edgeIdSet),from,to,type,label:coerceStr(e.label),note:coerceStr(e.note),direction:dir,strength:coerceNum(e.strength,3,1,5)});
  });
  const confusion_groups=[];const cgIdSet=new Set();
  coerceArr(raw.confusion_groups).forEach(g=>{
    if(!g||!coerceStr(g.name_de).trim()){report.dropped.push("confusion_group(无 name_de)");return;}
    const cid=makeConfusionSlug(g.name_de,cgIdSet);
    const word_ids=coerceArr(g.word_ids).map(wid=>wordIdMap[coerceStr(wid)]||coerceStr(wid)).filter(wid=>{if(wordIds.has(wid))return true;report.fixed.push(`confusion ${cid} word_id ${wid} 失效→移除`);return false;});
    const examples=coerceArr(g.examples).map(ex=>({word:coerceStr(ex&&ex.word),cn:coerceStr(ex&&ex.cn),usage:coerceStr(ex&&ex.usage),collocation:coerceStr(ex&&ex.collocation),example_de:coerceStr(ex&&ex.example_de),example_cn:coerceStr(ex&&ex.example_cn)}));
    confusion_groups.push({id:cid,name_cn:coerceStr(g.name_cn),name_de:coerceStr(g.name_de).trim(),word_ids,explanation:coerceStr(g.explanation),examples,created_at:coerceStr(g.created_at)||now(),updated_at:now()});
  });
  const settings=(raw.settings&&typeof raw.settings==="object")?raw.settings:{};
  if(settings.positions&&typeof settings.positions==="object"){
    const np={};Object.keys(settings.positions).forEach(k=>{const nk=wordIdMap[k]||topicIdMap[k]||k;np[nk]=settings.positions[k];});settings.positions=np;
  }
  report.remapped=Object.keys(wordIdMap).length+Object.keys(topicIdMap).length;
  return {ok:true,db:{version:"3.0.0",words,edges,topics,confusion_groups,settings},report};
}

/* ============ DB + 状态 ============ */
let DB={version:"3.0.0",words:[],edges:[],topics:[],confusion_groups:[],settings:{}};
let dirty=false,noLocalData=false;
function emptyDB(){return{version:"3.0.0",words:[],edges:[],topics:[],confusion_groups:[],settings:{}};}
const wordById=id=>DB.words.find(w=>w.id===id);
const topicById=id=>DB.topics.find(t=>t.id===id);
let _edgeIndex=null;
function rebuildEdgeIndex(){_edgeIndex={};DB.edges.forEach(e=>{(_edgeIndex[e.from]=_edgeIndex[e.from]||[]).push(e);(_edgeIndex[e.to]=_edgeIndex[e.to]||[]).push(e);});}
function wordEdges(id){if(!_edgeIndex)rebuildEdgeIndex();return _edgeIndex[id]||[];}
const isIsolated=id=>wordEdges(id).length===0&&!DB.words.find(w=>w.id===id)?.topic_ids?.length;

function hasDistinction(w){
  const inCg=DB.confusion_groups.some(g=>(g.word_ids||[]).includes(w.id)&&(g.examples||[]).some(ex=>ex.word===w.word&&coerceStr(ex.usage).trim()));
  if(inCg)return true;
  return wordEdges(w.id).some(e=>(e.type==="confusion"||e.type==="chinese_overlap")&&coerceStr(e.note).trim());
}
function computeStatus(w){
  const hasExplain=!!coerceStr(w.meaning_cn).trim();
  const hasTopic=(w.topic_ids||[]).length>0;
  const hasEdge=wordEdges(w.id).length>0;
  const hasExample=!!coerceStr(w.example_de).trim();
  const hasDist=hasDistinction(w);
  if(hasExample&&hasEdge&&hasDist)return "complete";
  if(hasEdge&&hasDist)return "compared";
  if(hasEdge)return "linked";
  if(hasTopic)return "topic_only";
  if(hasExplain)return "explained";
  return "raw";
}
function missingItems(w){
  const m=[];
  if(!coerceStr(w.meaning_cn).trim())m.push("无中文解释");
  if(!(w.topic_ids||[]).length)m.push("未加入专题");
  if(wordEdges(w.id).length===0)m.push("未连接其他词");
  if(!coerceStr(w.example_de).trim())m.push("无例句");
  if(w.needs_contrast&&!hasDistinction(w))m.push("需区别说明但未写");
  return m;
}
function isB1Pending(w){if(w.level!=="B1")return false;return computeStatus(w)!=="complete";}
function isPending(w){return computeStatus(w)!=="complete";}

function markDirty(){dirty=true;updateDirtyIndicator();}
function save(){storage.save(DB);rebuildEdgeIndex();invalidateLinkable();markDirty();}
function needsMigration(db){
  if(!db||!Array.isArray(db.words))return false;
  if(db.review_logs!==undefined)return true;
  return db.words.some(w=>w.status!==undefined||w.review_due!==undefined||w.mistake_count!==undefined||w.difficulty!==undefined||w.is_new_b1!==undefined);
}
function load(){
  const data=storage.load();
  if(data===null){DB=emptyDB();noLocalData=true;}
  else{DB=data;noLocalData=false;}
  if(needsMigration(DB)){const r=sanitizeAndMigrate(DB);if(r.ok){DB=r.db;storage.save(DB);}}
  ["words","edges","topics","confusion_groups"].forEach(k=>{if(!Array.isArray(DB[k]))DB[k]=[];});
  if(!DB.settings)DB.settings={};
  DB.words.forEach(w=>{if(w.needs_contrast===undefined)w.needs_contrast=false;if(w.is_key===undefined)w.is_key=false;});
  rebuildEdgeIndex();
  dirty=false;
}
function updateDirtyIndicator(){
  document.title=(dirty?"● ":"")+"德语词汇关系网";
  const el=document.getElementById("dirty-tip");
  if(el){el.textContent=dirty?"⚠ 有改动未导出到文件":"✓ 已与文件同步";el.style.color=dirty?"var(--warning)":"var(--ok)";}
}

/* ============ 分页 ============ */
const PAGE_SIZE=50;
const pageState={pool:1,table:1,confusion:1,check_isolated:1,check_topicNoLink:1,check_edgeNoNote:1,check_needDist:1,check_notComplete:1,check_linkable:1};
function paginate(arr,page){
  const total=arr.length;
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const p=Math.min(Math.max(1,page),pages);
  const start=(p-1)*PAGE_SIZE;
  return {slice:arr.slice(start,start+PAGE_SIZE),page:p,pages,total,start};
}
function pagerHTML(pg,onNav){
  if(pg.pages<=1)return `<div class="pager"><span class="pg-info">共 ${pg.total} 项</span></div>`;
  const btn=(label,target,dis,cur)=>`<button ${dis?"disabled":""} class="${cur?"cur":""}" onclick="${onNav}(${target})">${label}</button>`;
  let mid="";
  const win=2;
  const lo=Math.max(1,pg.page-win),hi=Math.min(pg.pages,pg.page+win);
  if(lo>1)mid+=btn("1",1,false,pg.page===1)+(lo>2?'<span class="pg-info">…</span>':"");
  for(let i=lo;i<=hi;i++)mid+=btn(String(i),i,false,i===pg.page);
  if(hi<pg.pages)mid+=(hi<pg.pages-1?'<span class="pg-info">…</span>':"")+btn(String(pg.pages),pg.pages,false,pg.page===pg.pages);
  return `<div class="pager">
    ${btn("‹",pg.page-1,pg.page<=1,false)}
    ${mid}
    ${btn("›",pg.page+1,pg.page>=pg.pages,false)}
    <span class="pg-info">${pg.start+1}–${Math.min(pg.start+PAGE_SIZE,pg.total)} / ${pg.total}</span>
  </div>`;
}

/* ============ 图谱 ============ */
let network=null;
let linkMode=false;
let linkFrom=null;
const GRAPH_NODE_WARN=800;
const INDIRECT_MAX_HOPS=3;      // 间接边: 最多经过 (HOPS-1) 个隐藏中间节点
const INDIRECT_VISIBLE_CAP=600; // 可见词节点超此数时跳过间接边计算(防大量 BFS)
function statusColor(w){return statusColorMap()[computeStatus(w)]||"#8a8a94";}
function edgeStyle(type,direction){
  const m={synonym:{dashes:false},prefix_derivation:{arrows:"to"},topic_member:{dashes:true,color:{color:"#666"}},
    confusion:{color:{color:"#d4c44a"},dashes:[4,4]},collocation:{dashes:[2,4]},
    formal_register:{arrows:"to"},antonym:{color:{color:"#c060c0"},dashes:true}};
  const base=Object.assign({},m[type]||{});
  if(direction==="undirected"){delete base.arrows;}
  else if(direction==="directed"&&!base.arrows){base.arrows="to";}
  return base;
}

let focusSeed=null;
const FOCUS_REACH_MODE="directed";
function computeReachable(seedId){
  const adj={};
  DB.edges.forEach(e=>{
    if(e.direction==="undirected"||FOCUS_REACH_MODE==="undirected"){
      (adj[e.from]=adj[e.from]||[]).push(e.to);
      (adj[e.to]=adj[e.to]||[]).push(e.from);
    }else{
      (adj[e.from]=adj[e.from]||[]).push(e.to);
    }
  });
  const reach=new Set([seedId]);
  const q=[seedId];let qi=0;
  while(qi<q.length){
    const cur=q[qi++];
    for(const nx of (adj[cur]||[])){
      if(!reach.has(nx)){reach.add(nx);q.push(nx);}
    }
  }
  return reach;
}

function applyViewFilter(words){
  const view=(document.getElementById("g-view")||{}).value||"global";
  switch(view){
    case "neighbor":{
      const sel=network?network.getSelectedNodes():[];
      const seedId=(typeof focusSeed!=="undefined"&&focusSeed)?focusSeed:(sel.length?sel[0]:null);
      if(!seedId)return words;
      const reach=computeReachable(seedId);
      return words.filter(w=>reach.has(w.id));
    }
    case "topic":return words.filter(w=>(w.topic_ids||[]).length>0);
    case "b1pending":return words.filter(isPending);
    case "confusion":{const inCg=new Set();DB.confusion_groups.forEach(g=>(g.word_ids||[]).forEach(id=>inCg.add(id)));return words.filter(w=>inCg.has(w.id));}
    case "isolated":return words.filter(w=>wordEdges(w.id).length===0&&!(w.topic_ids||[]).length);
    default:return words;
  }
}

/*
 间接边计算(定义 A):
 - visibleWordIds: 当前视图可见的词节点 id 集合
 - 对每个可见节点 s 做 BFS, 只允许穿过"不可见"的词节点, 直到碰到另一个可见节点 t
 - 若 s、t 之间存在这样一条"全程经隐藏节点"的路径, 且 s、t 之间当前无直接可见边, 则补一条间接边
 - 方向: 若整条路径每一跳都同向(全部 from→to 顺向)可串成 s→t, 则有向; 否则无向
 邻接构建: 对每条真实边, 记录 (from,to,directed?) 供顺向/逆向判断
*/
function computeIndirectEdges(visibleWordIds){
  const visible=new Set(visibleWordIds);
  if(visible.size===0||visible.size>INDIRECT_VISIBLE_CAP)return {edges:[],skipped:visible.size>INDIRECT_VISIBLE_CAP};
  // 邻接表: node -> [{to, dir:'fwd'|'bwd'|'undir'}]
  // fwd 表示沿有向边正向(可走), bwd 表示沿有向边反向(方向传递时视为破坏同向链), undir 无向边
  const adj={};
  const wordSetAll=new Set(DB.words.map(w=>w.id));
  DB.edges.forEach(e=>{
    if(!wordSetAll.has(e.from)||!wordSetAll.has(e.to))return;
    (adj[e.from]=adj[e.from]||[]).push({to:e.to,dir:e.direction==="undirected"?"undir":"fwd"});
    (adj[e.to]=adj[e.to]||[]).push({to:e.from,dir:e.direction==="undirected"?"undir":"bwd"});
  });
  // 已有可见直接边: 避免间接边与直接边重复
  const directVisiblePair=new Set();
  DB.edges.forEach(e=>{if(visible.has(e.from)&&visible.has(e.to)){const k=e.from<e.to?e.from+"|"+e.to:e.to+"|"+e.from;directVisiblePair.add(k);}});
  const result=new Map(); // pairKey -> {from,to,directed}
  const sources=[...visible];
  for(const s of sources){
    // BFS: 状态 = 当前节点 + 是否仍保持"从 s 出发全程顺向有向链"
    // allFwd: 到目前为止路径是否可解释为 s → ... → cur 的有向链(每跳都是 fwd, 不含 undir/bwd)
    const startNbrs=adj[s]||[];
    // 队列元素: [node, hops, allFwd]
    const queue=[];
    const bestFwd={}; // node -> 记录是否已以 allFwd=true 访问, 避免重复
    const bestAny={};
    for(const nb of startNbrs){
      queue.push([nb.to,1,nb.dir==="fwd"]);
    }
    let qi=0;
    while(qi<queue.length){
      const [node,hops,allFwd]=queue[qi++];
      if(node===s)continue;
      if(visible.has(node)){
        // 命中另一个可见节点 t=node, 且中间至少经过 1 个隐藏节点(hops>=2)
        if(hops>=2){
          const t=node;
          if(t!==s){
            const k=s<t?s+"|"+t:t+"|"+s;
            if(!directVisiblePair.has(k)){
              const prev=result.get(k);
              // 有向仅当 s->t 这个具体方向的链存在 allFwd
              const dirFwd=(s<t)?allFwd:false; // 归一化方向下, 只有 s 是较小 id 时 allFwd 才直接对应 from=s
              // 为保留方向语义, 单独按有序对记录
              const okey=s+"=>"+t;
              const rec=prev||{from:s,to:t,directed:false,_orderedFwd:false};
              // 记录: 若本条路径 allFwd 且方向是 s->t, 标记 orderedFwd
              if(allFwd){rec._sFwd=true;rec._sFwdFrom=s;rec._sFwdTo=t;}
              result.set(k,rec);
            }
          }
        }
        // 到达可见节点后不再继续穿越(可见节点不能作为隐藏中间点)
        continue;
      }
      // node 是隐藏节点, 可继续穿越
      if(hops>=INDIRECT_MAX_HOPS)continue;
      const key=node+"|"+(allFwd?"F":"A");
      if(allFwd){if(bestFwd[node])continue;bestFwd[node]=true;}
      else{if(bestAny[node])continue;bestAny[node]=true;}
      for(const nb of (adj[node]||[])){
        const nextAllFwd=allFwd&&nb.dir==="fwd";
        queue.push([nb.to,hops+1,nextAllFwd]);
      }
    }
  }
  // 生成 vis 边: 有向当且仅当存在某条 s->t 全程顺向链
  const edges=[];
  for(const [k,rec] of result){
    const directed=!!rec._sFwd;
    const from=directed?rec._sFwdFrom:rec.from;
    const to=directed?rec._sFwdTo:rec.to;
    edges.push({
      id:"indirect_"+k,
      from,to,
      dashes:[2,3],
      color:{color:currentTheme()==="light"?"#b0a060":"#7a7040"},
      width:1,
      arrows:directed?"to":undefined,
      label:"",
      _indirect:true
    });
  }
  return {edges,skipped:false};
}

function buildGraphData(){
  const flt={level:val("g-level"),status:val("g-status"),etype:val("g-etype"),topic:val("g-topic"),search:val("g-search").trim().toLowerCase()};
  let words=DB.words.slice();
  if(flt.level)words=words.filter(w=>w.level===flt.level);
  if(flt.status)words=words.filter(w=>computeStatus(w)===flt.status);
  if(flt.topic)words=words.filter(w=>(w.topic_ids||[]).includes(flt.topic));
  words=applyViewFilter(words);
  const view=(document.getElementById("g-view")||{}).value||"global";
  const showTopics=(view==="global"||view==="topic");
  // 是否处于"过滤态"(有任何过滤条件使部分节点被隐藏)
  const isFiltered=!!(flt.level||flt.status||flt.topic||(view!=="global"&&view!=="topic"));
  const matchTopicIds=new Set();
  if(flt.search)DB.topics.forEach(t=>{if(t.name_de.toLowerCase().includes(flt.search)||(t.name_cn||"").toLowerCase().includes(flt.search))matchTopicIds.add(t.id);});
  const wordSet=new Set(words.map(w=>w.id));
  const degree={};
  DB.edges.forEach(e=>{degree[e.from]=(degree[e.from]||0)+1;degree[e.to]=(degree[e.to]||0)+1;});
  const cmap=statusColorMap();
  const nodes=[];
  words.forEach(w=>{
    const deg=degree[w.id]||0;
    const size=14+Math.min(deg*4,24)+(w.is_key?4:0);
    const hitWord=flt.search&&(w.word.toLowerCase().includes(flt.search)||(w.meaning_cn||"").toLowerCase().includes(flt.search));
    const hitTopic=flt.search&&(w.topic_ids||[]).some(t=>matchTopicIds.has(t));
    const hit=hitWord||hitTopic;
    const isFrom=linkMode&&linkFrom===w.id;
    const col=cmap[computeStatus(w)]||"#8a8a94";
    const fontColor=currentTheme()==="light"?"#1e2530":"#e4e4e8";
    nodes.push({id:w.id,label:w.word,title:w.word+" · "+w.meaning_cn+" ["+STATUS_LABEL[computeStatus(w)]+"]",
      color:{background:col,border:isFrom?"#e0a020":(hit?(currentTheme()==="light"?"#1e2530":"#fff"):"#00000000"),highlight:{background:col,border:isFrom?"#e0a020":(currentTheme()==="light"?"#1e2530":"#fff")}},
      borderWidth:isFrom?4:(hit?3:1),size,shape:"dot",font:{color:fontColor,size:14},_type:"word"});
  });
  if(showTopics){
    DB.topics.forEach(t=>{
      if(flt.topic&&t.id!==flt.topic&&t.parent_topic!==flt.topic)return;
      const hit=flt.search&&matchTopicIds.has(t.id);
      nodes.push({id:t.id,label:t.name_de,title:t.name_de+" / "+t.name_cn,color:{background:"#5a5a64",border:hit?"#fff":"#8a8a94"},borderWidth:hit?3:1,shape:"box",font:{color:"#fff",size:15},_type:"topic"});
    });
  }
  const nodeSet=new Set(nodes.map(n=>n.id));
  const edges=[];
  DB.edges.forEach(e=>{
    if(flt.etype&&e.type!==flt.etype)return;
    if(!wordSet.has(e.from)||!wordSet.has(e.to))return;
    edges.push(Object.assign({id:e.id,from:e.from,to:e.to,label:e.label||"",font:{color:"#9a9aa4",size:10,strokeWidth:0},_type:"edge"},edgeStyle(e.type,e.direction)));
  });
  if(showTopics){
    DB.words.forEach(w=>{
      if(!wordSet.has(w.id))return;
      (w.topic_ids||[]).forEach(tid=>{if(!nodeSet.has(tid))return;edges.push({id:"tm_"+w.id+"_"+tid,from:w.id,to:tid,dashes:true,color:{color:"#555"}});});
    });
    DB.topics.forEach(t=>{if(t.parent_topic&&nodeSet.has(t.id)&&nodeSet.has(t.parent_topic))edges.push({id:"th_"+t.id,from:t.parent_topic,to:t.id,color:{color:"#666"},width:2});});
  }
  // 间接边: 仅在过滤态 + 开关开启时
  let indirectInfo={edges:[],skipped:false};
  const indirectOn=(document.getElementById("g-indirect")||{}).checked;
  if(isFiltered&&indirectOn){
    indirectInfo=computeIndirectEdges([...wordSet]);
    indirectInfo.edges.forEach(ie=>{if(wordSet.has(ie.from)&&wordSet.has(ie.to))edges.push(ie);});
  }
  const pos=DB.settings.positions||{};
  let hasNew=false;
  nodes.forEach(n=>{
    if(pos[n.id]){
      n.x=pos[n.id].x;n.y=pos[n.id].y;
      // 已有坐标的节点锁定, 物理引擎不移动它们, 保住既有布局
      n.fixed={x:true,y:true};
      n.physics=false;
    }else{
      hasNew=true;
      // 新节点参与物理, 自动寻位; 给一个初始点避免堆在(0,0)
      n.physics=true;
    }
  });
  return {nodes,edges,hasNew,indirectCount:indirectInfo.edges.length,indirectSkipped:indirectInfo.skipped};
}
function renderLegend(){
  const el=document.getElementById("graph-legend");
  if(!el)return;
  const cmap=statusColorMap();
  el.innerHTML=STATUS_ORDER.map(s=>`<span><i style="background:${cmap[s]}"></i>${STATUS_LABEL[s]}</span>`).join("")
    +`<span><i style="background:${currentTheme()==="light"?"#b0a060":"#7a7040"};border-radius:0;height:0;width:14px;border-top:2px dashed ${currentTheme()==="light"?"#b0a060":"#7a7040"}"></i>间接关系</span>`;
}
function renderGraph(doFit){
  const p=document.getElementById("page-graph");
  if(!DB.words.length&&!DB.topics.length){
    document.getElementById("graph").innerHTML="";
    document.getElementById("detail").innerHTML="";
    document.getElementById("graph-legend").innerHTML="";
    document.getElementById("graph").innerHTML=`<div class="empty-wrap">
      <h2>当前词库为空</h2>
      <p class="muted">这是一张德语词汇关系网，不是背单词软件。先加入一个词，再把它和其他词串联起来。</p>
      <div class="actions">
        <button class="primary" onclick="switchPage('edit')">添加第一个词</button>
        <button onclick="switchPage('io')">导入 JSON 备份</button>
      </div></div>`;
    return;
  }
  // 保留当前视口(仅当已有实例且要求保留)
  // 默认保留视口(不改缩放/平移). 仅 doFit=true 时允许重新 fit(唯一入口: 重置视图)
  let savedView=null;
  if(!doFit&&network){
    try{savedView={position:network.getViewPosition(),scale:network.getScale()};}catch(e){savedView=null;}
  }
  const data=buildGraphData();
  const container=document.getElementById("graph");
  const old=document.getElementById("graph-warn");if(old)old.remove();
  let warnMsgs=[];
  if(data.nodes.length>GRAPH_NODE_WARN)warnMsgs.push(`当前渲染 ${data.nodes.length} 个节点，可能较卡。建议用左上筛选缩小范围。`);
  if(data.indirectSkipped)warnMsgs.push(`可见节点过多(> ${INDIRECT_VISIBLE_CAP})，已跳过间接关系计算。缩小视图后可显示。`);
  if(warnMsgs.length){
    const warn=document.createElement("div");
    warn.id="graph-warn";
    warn.style.cssText="position:absolute;top:60px;left:10px;z-index:6;background:var(--panel-glass);border:1px solid var(--warning);color:var(--text);padding:8px 12px;border-radius:9px;font-size:12px;max-width:340px;box-shadow:var(--shadow-soft);backdrop-filter:blur(10px)";
    warn.innerHTML=warnMsgs.map(esc).join("<br>")+` <button style="margin-top:6px" onclick="this.parentElement.remove()">知道了</button>`;
    p.appendChild(warn);
  }
  // 保留视口时禁用物理和稳定化的自动 fit, 避免布局跳动改变视口
  const enablePhysics=data.hasNew;
  const options={
    layout:{randomSeed:42},
    physics:{enabled:enablePhysics,solver:"forceAtlas2Based",forceAtlas2Based:{gravitationalConstant:-45,springLength:110},stabilization:{iterations:120}},
    interaction:{hover:true,tooltipDelay:200},
    edges:{smooth:{type:"continuous"},color:{color:currentTheme()==="light"?"#c2c9d6":"#4a4a52",highlight:"#6ba3ff"}},
    nodes:{shadow:false}
  };
  network=new vis.Network(container,{nodes:data.nodes,edges:data.edges},options);
  if(!doFit){
    // 保留视口. 有新节点仍需物理定位新节点, 但稳定后强制还原视口, 不 fit
    if(data.hasNew){
      network.once("stabilizationIterationsDone",()=>{
        savePositions();
        unlockAllNodes();
        // 物理稳定可能移动视口, 还原到进入前
        if(savedView)network.moveTo({position:savedView.position,scale:savedView.scale,animation:false});
      });
    }else{
      network.setOptions({physics:{enabled:false}});
    }
    // 立即还原一次(覆盖 vis 创建实例时的默认 fit)
    if(savedView)network.moveTo({position:savedView.position,scale:savedView.scale,animation:false});
    unlockAllNodes();
  }else{
    // 唯一允许 fit 的路径: 重置视图
    if(data.hasNew){
      network.once("stabilizationIterationsDone",()=>{savePositions();unlockAllNodes();network.fit();});
    }else{
      network.setOptions({physics:{enabled:false}});
      network.fit();
    }
  }
  network.on("dragEnd",params=>{if(params.nodes.length)savePositions();});
  network.on("click",p=>{
    if(linkMode){
      if(p.nodes.length){
        const nid=p.nodes[0];
        const w=wordById(nid);
        if(!w)return;
        if(nid===linkFrom)return;
        renderInlineEdgeForm(linkFrom,nid);
      }
      return;
    }
    if(p.nodes.length)showNodeDetail(p.nodes[0]);
    else if(p.edges.length)showEdgeDetail(p.edges[0]);
  });
  renderLegend();
}

function unlockAllNodes(){
  if(!network)return;
  const upd=[];
  network.body.data.nodes.forEach(n=>{
    if(n.fixed){upd.push({id:n.id,fixed:false,physics:false});}
  });
  if(upd.length)network.body.data.nodes.update(upd);
}

function savePositions(){
  if(!network)return;
  const positions=network.getPositions();
  DB.settings.positions=Object.assign(DB.settings.positions||{},positions);
  network.setOptions({physics:{enabled:false}});
  save();
}
function showNodeDetail(id){
  const d=document.getElementById("detail");
  const w=wordById(id);
  if(w){
    const st=computeStatus(w);
    const rels=wordEdges(id).map(e=>{const other=wordById(e.from===id?e.to:e.from);return other?other.word:"";}).filter(Boolean);
    const tp=(w.topic_ids||[]).map(t=>topicById(t)?.name_de).filter(Boolean).join("、")||"—";
    const miss=missingItems(w);
    const verbFields=w.pos==="Verb"?`${w.separable?kv("可分","是"):""}${w.prefix?kv("前缀",esc(w.prefix)):""}${w.past_participle?kv("二分词",esc(w.past_participle)):""}${w.preterite?kv("过去式",esc(w.preterite)):""}${w.auxiliary?kv("助动词",esc(w.auxiliary)):""}${w.case_or_preposition?kv("支配",esc(w.case_or_preposition)):""}`:"";
    d.innerHTML=`<h3>${esc(w.word)}</h3>
      <div class="muted" style="margin-bottom:6px">${esc(w.level)} · ${esc(w.pos||"—")} · <span class="st-${st}">${STATUS_LABEL[st]}</span></div>
      ${kv("中文",esc(w.meaning_cn)||"—")}${w.meaning_en?kv("英文",esc(w.meaning_en)):""}
      ${w.article?kv("冠词",esc(w.article)):""}${w.plural?kv("复数",esc(w.plural)):""}
      ${verbFields}
      ${(w.collocations||[]).length?kv("搭配",w.collocations.map(esc).join("、")):""}
      ${kv("专题",esc(tp))}
      ${kv("相关词",rels.length?rels.map(esc).join("、"):"—")}
      ${w.example_de?kv("例句",esc(w.example_de)):""}${w.example_cn?kv("翻译",esc(w.example_cn)):""}
      ${w.note?kv("备注",esc(w.note)):""}
      ${miss.length?`<div class="miss" style="margin-top:6px">缺失项：${miss.map(esc).join(" · ")}</div>`:`<div style="color:var(--ok);font-size:12px;margin-top:6px">✓ 整理完成</div>`}
      <div class="ops">
        <button class="primary" onclick="startLinkMode('${w.id}')">➕ 在图上连边(点此再点目标词)</button>
        <button onclick="quickLink('${w.id}')">在编辑页连接其他词</button>
        <button onclick="quickTopic('${w.id}')">加入专题</button>
        <button onclick="quickConfusion('${w.id}')">加入易混淆组</button>
        <button onclick="quickDistinction('${w.id}')">写区别说明</button>
        <button onclick="focusNode('${w.id}')">以此词为中心查看</button>
        <button onclick="whyNotComplete('${w.id}')">检查为何未完成</button>
        <button onclick="goEditWord('${w.id}')">编辑词条</button>
      </div>`;
  }else{
    const t=topicById(id);if(!t)return;
    const members=DB.words.filter(w=>(w.topic_ids||[]).includes(id));
    const subs=DB.topics.filter(x=>x.parent_topic===id);
    d.innerHTML=`<h3>${esc(t.name_de)}</h3>
      ${kv("中文",esc(t.name_cn))}${kv("说明",esc(t.description||"—"))}
      ${kv("子专题",subs.map(s=>esc(s.name_de)).join("、")||"—")}
      ${kv("包含词",members.length)}
      <hr>${members.slice(0,80).map(w=>`<div class="row"><span class="st-${computeStatus(w)}">●</span> ${esc(w.word)} <span class="muted">${esc(w.meaning_cn)}</span></div>`).join("")}${members.length>80?`<div class="muted">仅显示前 80 个</div>`:""}
      <div class="ops"><button class="primary" onclick="switchPage('topics')">管理专题</button></div>`;
  }
}

/* ===== 图谱内连边模式 ===== */
window.startLinkMode=id=>{const w=wordById(id);if(!w)return;linkMode=true;linkFrom=id;renderLinkModeBanner();renderGraph();};
window.cancelLinkMode=()=>{linkMode=false;linkFrom=null;renderGraph();document.getElementById("detail").innerHTML="<span class='muted'>已退出连边模式</span>";};
function renderLinkModeBanner(){
  const w=wordById(linkFrom);
  const d=document.getElementById("detail");
  d.innerHTML=`<div class="linkmode-banner">
    连边模式：起点 <b>${esc(w?w.word:"")}</b><br>
    在图上点击<b>目标词</b>作为终点。若选“有向”，箭头方向为 <b>${esc(w?w.word:"")} → 目标</b>。
    </div>
    <button class="danger" onclick="cancelLinkMode()">取消连边</button>`;
}
function renderInlineEdgeForm(fromId,toId){
  const f=wordById(fromId),t=wordById(toId);
  if(!f||!t)return;
  const relOpts=REL_TYPES.map(r=>`<option value="${r[0]}">${r[1]}(${r[0]})</option>`).join("");
  const d=document.getElementById("detail");
  d.innerHTML=`<div class="linkmode-banner">
    新建关系：<b>${esc(f.word)}</b> → <b>${esc(t.word)}</b>
    </div>
    <div class="inline-edgeform">
      <label>关系类型</label>
      <select id="ief-type">${relOpts}</select>
      <div class="ef-row">
        <label>方向</label>
        <select id="ief-dir">
          <option value="undirected">无向(近义/对称关系)</option>
          <option value="directed">有向(派生/延伸，箭头 ${esc(f.word)}→${esc(t.word)})</option>
        </select>
      </div>
      <div class="ef-row"><label>图上标签(可空)</label><input id="ief-label" placeholder="如: →umfassen / 更正式"></div>
      <div class="ef-row"><label>关系/区别说明(可空)</label><textarea id="ief-note"></textarea></div>
      <div class="ef-btns">
        <button class="primary" onclick="commitInlineEdge('${fromId}','${toId}')">保存关系</button>
        <button onclick="renderLinkModeBanner()">重选目标</button>
        <button class="danger" onclick="cancelLinkMode()">退出连边</button>
      </div>
    </div>`;
}
window.commitInlineEdge=(fromId,toId)=>{
  const f=wordById(fromId),t=wordById(toId);
  if(!f||!t){alert("词条不存在");return;}
  if(fromId===toId){alert("不能连接到自身");return;}
  const type=val("ief-type");
  const dir=val("ief-dir");
  const label=val("ief-label").trim();
  const note=val("ief-note").trim();
  const dup=DB.edges.find(e=>e.from===fromId&&e.to===toId&&e.type===type);
  if(dup&&!confirm("已存在相同类型的同向关系，仍要再建一条?"))return;
  const used=new Set(DB.edges.map(e=>e.id));
  DB.edges.push({id:makeEdgeSlug(fromId,toId,type,used),from:fromId,to:toId,type,label,note,direction:dir,strength:3});
  save();
  linkMode=true;
  renderGraph();
  renderLinkModeBanner();
};

function showEdgeDetail(id){
  const d=document.getElementById("detail");
  // 间接边: 不在 DB.edges 中
  if(id&&id.indexOf("indirect_")===0){
    const k=id.slice("indirect_".length);
    const [a,b]=k.split("|");
    const wa=wordById(a),wb=wordById(b);
    d.innerHTML=`<h3>间接关系</h3>
      <div class="muted" style="margin-bottom:6px">这两词在完整图上通过被当前视图隐藏的中间词相连，此处为推导出的间接连线，非真实边。</div>
      ${kv("端点",(wa?esc(wa.word):a)+" — "+(wb?esc(wb.word):b))}
      <div class="ops"><button onclick="showFullPathBetween('${a}','${b}')">查看中间路径</button></div>`;
    return;
  }
  const e=DB.edges.find(x=>x.id===id);
  if(!e){d.innerHTML="<span class='muted'>该连线为专题/结构关系</span>";return;}
  const f=wordById(e.from),t=wordById(e.to);const rl=REL_TYPES.find(x=>x[0]===e.type);
  d.innerHTML=`<h3>关系</h3>
    ${kv("类型",(rl?rl[1]:e.type))}${kv("起点",f?esc(f.word):e.from)}${kv("终点",t?esc(t.word):e.to)}
    ${kv("方向",e.direction)}${e.note?kv("说明",esc(e.note)):kv("说明","<span class='miss'>未写关系说明</span>")}
    <div class="ops">
      <button onclick="toggleEdgeDirection('${e.id}')">切换方向(有向/无向)</button>
      <button onclick="editEdgeNote('${e.id}')">补写/修改说明</button>
      <button class="danger" onclick="delEdge('${e.id}')">删除关系</button>
    </div>`;
}
// 显示两点间在完整图上的一条最短路径(含隐藏中间词)
window.showFullPathBetween=(a,b)=>{
  const adj={};
  DB.edges.forEach(e=>{(adj[e.from]=adj[e.from]||[]).push(e.to);(adj[e.to]=adj[e.to]||[]).push(e.from);});
  const prev={};prev[a]=null;const q=[a];let qi=0,found=false;
  while(qi<q.length){const cur=q[qi++];if(cur===b){found=true;break;}for(const nx of (adj[cur]||[])){if(!(nx in prev)){prev[nx]=cur;q.push(nx);}}}
  const d=document.getElementById("detail");
  if(!found){d.innerHTML="<span class='muted'>无路径</span>";return;}
  const path=[];let c=b;while(c!==null){path.unshift(c);c=prev[c];}
  d.innerHTML=`<h3>间接路径</h3><div class="row">${path.map(id=>esc(wordById(id)?.word||id)).join(" → ")}</div>
    <div class="muted" style="margin-top:6px">中间词在当前视图被隐藏，故仅以间接连线表示两端关系。</div>`;
};
window.delEdge=id=>{DB.edges=DB.edges.filter(e=>e.id!==id);save();renderGraph();document.getElementById("detail").innerHTML="<span class='muted'>已删除</span>";};
window.editEdgeNote=id=>{const e=DB.edges.find(x=>x.id===id);if(!e)return;const v=prompt("关系说明：",e.note||"");if(v===null)return;e.note=v.trim();save();renderGraph();showEdgeDetail(id);};
window.toggleEdgeDirection=id=>{const e=DB.edges.find(x=>x.id===id);if(!e)return;e.direction=e.direction==="directed"?"undirected":"directed";save();renderGraph();showEdgeDetail(id);};
window.focusNode=id=>{
  focusSeed=id;
  document.getElementById("g-view").value="neighbor";
  renderGraph();
  if(network)network.selectNodes([id]);
};
window.whyNotComplete=id=>{const w=wordById(id);if(!w)return;const m=missingItems(w);const st=computeStatus(w);if(st==="complete"){alert("该词已整理完成。");return;}alert("整理完成还需补齐：\n"+(m.length?m.map(x=>"· "+x).join("\n"):"（缺条件：需同时有例句、关系、区别说明）"));};

/* ============ 快速操作 ============ */
window.quickLink=id=>{editingWordId=id;pendingFocus="link";switchPage("edit");};
window.quickTopic=id=>{editingWordId=id;pendingFocus="topic";switchPage("edit");};
window.quickDistinction=id=>{editingWordId=id;pendingFocus="dist";switchPage("edit");};
window.quickConfusion=id=>{
  const w=wordById(id);if(!w)return;
  if(!DB.confusion_groups.length){alert("还没有易混淆组，请先在易混淆组页创建。");switchPage("confusion");return;}
  const names=DB.confusion_groups.map((g,i)=>`${i+1}. ${g.name_cn||g.name_de}`).join("\n");
  const pick=prompt("加入哪个易混淆组？输入编号：\n"+names);
  if(pick===null)return;
  const idx=parseInt(pick,10)-1;
  const g=DB.confusion_groups[idx];
  if(!g){alert("编号无效");return;}
  if(!g.word_ids.includes(id)){g.word_ids.push(id);if(!(g.examples||[]).some(e=>e.word===w.word))g.examples.push({word:w.word,cn:w.meaning_cn,usage:"",collocation:"",example_de:"",example_cn:""});g.updated_at=now();save();}
  alert("已加入组："+(g.name_cn||g.name_de));
  showNodeDetail(id);
};

/* ============ 自定义 autocomplete ============ */
const AC_MAX=6;
function acSearch(q){
  const s=coerceStr(q).trim().toLowerCase();
  if(!s)return [];
  const starts=[],contains=[];
  for(const w of DB.words){
    const de=w.word.toLowerCase(),cn=(w.meaning_cn||"").toLowerCase();
    if(de.startsWith(s))starts.push(w);
    else if(de.includes(s)||cn.includes(s))contains.push(w);
    if(starts.length>=AC_MAX)break;
  }
  return starts.concat(contains).slice(0,AC_MAX);
}
let _acActive=-1,_acCurrent=[];
function bindAutocomplete(inputId,listId,hiddenId){
  const input=document.getElementById(inputId);
  const list=document.getElementById(listId);
  const hidden=document.getElementById(hiddenId);
  if(!input||!list)return;
  const close=()=>{list.classList.remove("open");list.innerHTML="";_acActive=-1;_acCurrent=[];};
  const render=items=>{
    _acCurrent=items;_acActive=-1;
    if(!items.length){close();return;}
    list.innerHTML=items.map((w,i)=>`<div class="ac-item" data-i="${i}">${esc(w.word)}<span class="ac-cn">${esc(w.meaning_cn)} · ${esc(w.pos||"")} ${esc(w.level)}</span></div>`).join("");
    list.classList.add("open");
    [...list.querySelectorAll(".ac-item")].forEach(el=>{el.onmousedown=ev=>{ev.preventDefault();pick(parseInt(el.dataset.i,10));};});
  };
  const pick=i=>{const w=_acCurrent[i];if(!w)return;input.value=w.word+" · "+(w.meaning_cn||"");if(hidden)hidden.value=w.id;close();};
  input.oninput=()=>{if(hidden)hidden.value="";render(acSearch(input.value));};
  input.onkeydown=ev=>{
    if(!list.classList.contains("open"))return;
    const items=list.querySelectorAll(".ac-item");
    if(ev.key==="ArrowDown"){ev.preventDefault();_acActive=Math.min(items.length-1,_acActive+1);}
    else if(ev.key==="ArrowUp"){ev.preventDefault();_acActive=Math.max(0,_acActive-1);}
    else if(ev.key==="Enter"){if(_acActive>=0){ev.preventDefault();pick(_acActive);}return;}
    else if(ev.key==="Escape"){close();return;}
    else return;
    items.forEach((el,i)=>el.classList.toggle("active",i===_acActive));
    if(items[_acActive])items[_acActive].scrollIntoView({block:"nearest"});
  };
  input.onblur=()=>setTimeout(close,120);
}

/* ============ 添加/编辑词条 ============ */
let editingWordId=null;
let pendingFocus=null;
function renderEdit(){
  const p=document.getElementById("page-edit");
  const topicOpts=DB.topics.map(t=>`<option value="${t.id}">${esc(t.name_de)} / ${esc(t.name_cn)}</option>`).join("");
  const relOpts=REL_TYPES.map(r=>`<option value="${r[0]}">${r[1]}(${r[0]})</option>`).join("");
  const posOpts=VALID_POS.filter(x=>x).map(x=>`<option value="${x}">${x}</option>`).join("")+`<option value="__other__">其他(手填)</option>`;
  p.innerHTML=`
  <div class="edit-actionbar">
    <button class="primary" onclick="saveWord()">保存词条</button>
    <button onclick="clearWordForm()">清空/新建</button>
    <span id="del-word-btn"></span>
    <span class="spacer"></span>
    <span class="edit-hint" id="edit-title">添加词条</span>
  </div>
  <div class="edit-grid">
    <div class="group"><h3>基础信息</h3>
      <div class="form-grid">
        <div><label>德语词*</label><input id="f-word"></div>
        <div><label>原形 lemma</label><input id="f-lemma"></div>
        <div><label>词性</label><select id="f-pos" onchange="onPosChange()">${posOpts}</select><input id="f-pos-other" placeholder="手填词性" style="display:none;margin-top:4px"></div>
        <div><label>等级</label><select id="f-level"><option>A1</option><option>A2</option><option selected>B1</option><option>B2</option></select></div>
        <div><label>中文意思</label><input id="f-cn"></div>
        <div><label>英文辅助</label><input id="f-en"></div>
        <div><label>是否重点整理词</label><select id="f-key"><option value="false">否</option><option value="true">是</option></select></div>
        <div><label>是否需要区别说明</label><select id="f-needc"><option value="false">否</option><option value="true">是</option></select></div>
        <div class="full"><label>备注</label><textarea id="f-note"></textarea></div>
      </div>
    </div>
    <div class="group"><h3>德语语法信息</h3>
      <div class="form-grid">
        <div><label>冠词</label><input id="f-article" placeholder="der/die/das"></div>
        <div><label>复数</label><input id="f-plural"></div>
        <div><label>是否可分</label><select id="f-separable"><option value="false">否</option><option value="true">是</option></select></div>
        <div><label>前缀</label><input id="f-prefix" placeholder="ver- / be- / ab-"></div>
        <div><label>二分词 Partizip II</label><input id="f-pp"></div>
        <div><label>过去式 Präteritum</label><input id="f-pret"></div>
        <div><label>助动词</label><select id="f-aux"><option value="">—</option><option>haben</option><option>sein</option></select></div>
        <div><label>支配格 / 介词</label><input id="f-case" placeholder="+ Akk / mit + Dat"></div>
        <div class="full"><label>固定搭配(逗号分隔)</label><input id="f-colloc"></div>
      </div>
    </div>
    <div class="group"><h3>例句</h3>
      <div class="form-grid">
        <div class="full"><label>德语例句</label><input id="f-exde"></div>
        <div class="full"><label>中文翻译</label><input id="f-excn"></div>
      </div>
    </div>
    <div class="group"><h3>串联信息</h3>
      <div class="form-grid">
        <div class="full"><label>所属专题(可多选)</label><select id="f-topics" multiple size="4">${topicOpts}</select></div>
      </div>
      ${DB.words.length<1?'<p class="muted">先保存本词后即可添加与其他词的关系。</p>':`
      <hr><b style="font-size:13px">添加一条关系(把本词连到旧词)</b>
      <div class="form-grid" style="margin-top:8px">
        <div>
          <label>相关旧词(输入时出现候选)</label>
          <div class="ac-wrap"><input id="r-to" placeholder="输入德语或中文…" autocomplete="off"><div class="ac-list" id="r-to-list"></div></div>
          <input type="hidden" id="r-to-id">
        </div>
        <div><label>关系类型</label><select id="r-type">${relOpts}</select></div>
        <div><label>图上标签</label><input id="r-label"></div>
        <div><label>方向</label><select id="r-dir"><option value="undirected">无向(近义/对称)</option><option value="directed">有向(派生/延伸)</option></select></div>
        <div class="full"><label>区别说明 / 关系说明</label><textarea id="r-note"></textarea></div>
      </div>
      <button style="margin-top:8px" onclick="saveEdgeFromEdit()">保存关系(本词 → 旧词)</button>
      <span class="muted" style="font-size:11px">需先保存或正在编辑本词</span>`}
    </div>
  </div>`;
  if(editingWordId)fillWordForm(editingWordId);
  if(DB.words.length>=1)bindAutocomplete("r-to","r-to-list","r-to-id");
  if(pendingFocus){
    const map={link:"r-to",topic:"f-topics",dist:"r-note"};
    const el=document.getElementById(map[pendingFocus]);
    if(el){el.scrollIntoView({block:"center"});el.focus&&el.focus();}
    pendingFocus=null;
  }
}
window.onPosChange=()=>{const other=document.getElementById("f-pos-other");if(!other)return;other.style.display=(val("f-pos")==="__other__")?"block":"none";};
window.goEditWord=id=>{editingWordId=id;switchPage("edit");};
function fillWordForm(id){
  const w=wordById(id);if(!w)return;
  const set=(f,v)=>{const el=document.getElementById(f);if(el)el.value=v??"";};
  set("f-word",w.word);set("f-lemma",w.lemma);set("f-level",w.level);
  set("f-article",w.article);set("f-plural",w.plural);set("f-cn",w.meaning_cn);set("f-en",w.meaning_en);
  set("f-key",String(w.is_key));set("f-needc",String(w.needs_contrast));set("f-exde",w.example_de);set("f-excn",w.example_cn);
  set("f-note",w.note);set("f-separable",String(w.separable));set("f-prefix",w.prefix);set("f-pp",w.past_participle);
  set("f-pret",w.preterite);set("f-aux",w.auxiliary);set("f-case",w.case_or_preposition);set("f-colloc",(w.collocations||[]).join(","));
  const posSel=document.getElementById("f-pos"),posOther=document.getElementById("f-pos-other");
  if(posSel){
    if(w.pos===""){posSel.value="";posOther.style.display="none";posOther.value="";}
    else if([...posSel.options].some(o=>o.value===w.pos)){posSel.value=w.pos;posOther.style.display="none";posOther.value="";}
    else{posSel.value="__other__";posOther.style.display="block";posOther.value=w.pos;}
  }
  const ts=document.getElementById("f-topics");[...ts.options].forEach(o=>o.selected=(w.topic_ids||[]).includes(o.value));
  document.getElementById("edit-title").textContent="编辑词条: "+w.word;
  document.getElementById("del-word-btn").innerHTML=`<button class="danger" onclick="delWord('${id}')">删除此词条</button>`;
}
window.clearWordForm=()=>{editingWordId=null;renderEdit();};
window.saveWord=()=>{
  const word=val("f-word").trim();
  if(!word){alert("德语词不能为空");return;}
  let pos=val("f-pos");if(pos==="__other__")pos=val("f-pos-other").trim();
  const topics=[...document.getElementById("f-topics").selectedOptions].map(o=>o.value);
  const colloc=val("f-colloc").split(",").map(s=>s.trim()).filter(Boolean);
  const data={word,lemma:val("f-lemma").trim()||word,pos,level:val("f-level"),
    article:val("f-article").trim(),plural:val("f-plural").trim(),meaning_cn:val("f-cn").trim(),meaning_en:val("f-en").trim(),
    is_key:val("f-key")==="true",needs_contrast:val("f-needc")==="true",
    example_de:val("f-exde").trim(),example_cn:val("f-excn").trim(),topic_ids:topics,note:val("f-note").trim(),
    separable:val("f-separable")==="true",prefix:val("f-prefix").trim(),past_participle:val("f-pp").trim(),
    preterite:val("f-pret").trim(),auxiliary:val("f-aux"),case_or_preposition:val("f-case").trim(),collocations:colloc,
    updated_at:now()};
  if(editingWordId){Object.assign(wordById(editingWordId),data);}
  else{
    const used=new Set(DB.words.map(w=>w.id));
    const nw=Object.assign(wordDefaults(),data,{id:makeWordSlug(word,data.pos,used),source:"manual",created_at:now()});
    DB.words.push(nw);
    editingWordId=nw.id;
  }
  save();
  alert("已保存");
  renderEdit();
};
window.delWord=id=>{
  if(!confirm("删除该词条及其关联关系?"))return;
  DB.words=DB.words.filter(w=>w.id!==id);
  DB.edges=DB.edges.filter(e=>e.from!==id&&e.to!==id);
  DB.confusion_groups.forEach(g=>{g.word_ids=(g.word_ids||[]).filter(x=>x!==id);g.examples=(g.examples||[]).filter(e=>{const ww=DB.words.find(x=>x.word===e.word);return true;});});
  if(DB.settings.positions)delete DB.settings.positions[id];
  save();clearWordForm();
};
window.saveEdgeFromEdit=()=>{
  if(!editingWordId){alert("请先保存本词，再添加关系");return;}
  const toId=val("r-to-id");
  if(!toId||!wordById(toId)){alert("相关旧词未识别：请从候选列表中点选");return;}
  if(toId===editingWordId){alert("不能连接到自身");return;}
  const used=new Set(DB.edges.map(e=>e.id));
  DB.edges.push({id:makeEdgeSlug(editingWordId,toId,val("r-type"),used),from:editingWordId,to:toId,type:val("r-type"),label:val("r-label").trim(),note:val("r-note").trim(),direction:val("r-dir"),strength:3});
  save();
  document.getElementById("r-to").value="";document.getElementById("r-to-id").value="";document.getElementById("r-label").value="";document.getElementById("r-note").value="";
  alert("关系已保存");
};

/* ============ 待串联词(全等级 + 搜索 + 分页) ============ */
let poolSearch="",poolLevel="";
function renderPool(){
  const p=document.getElementById("page-pool");
  let scope=DB.words.filter(isPending);
  if(poolLevel)scope=scope.filter(w=>w.level===poolLevel);
  if(poolSearch){const s=poolSearch.toLowerCase();scope=scope.filter(w=>w.word.toLowerCase().includes(s)||(w.meaning_cn||"").toLowerCase().includes(s));}
  const pg=paginate(scope,pageState.pool);
  pageState.pool=pg.page;
  const row=w=>{
    const miss=missingItems(w);
    const nextBtns=[];
    if(wordEdges(w.id).length===0)nextBtns.push(`<button onclick="quickLink('${w.id}')">连接旧词</button>`);
    if(!(w.topic_ids||[]).length)nextBtns.push(`<button onclick="quickTopic('${w.id}')">加入专题</button>`);
    if(w.needs_contrast&&!hasDistinction(w))nextBtns.push(`<button onclick="quickDistinction('${w.id}')">写区别</button>`);
    nextBtns.push(`<button onclick="goEditWord('${w.id}')">编辑</button>`);
    return `<div class="card">
      <b>${esc(w.word)}</b> <span class="badge b-${w.level}">${w.level}</span>
      <span class="pill" style="cursor:default">${STATUS_LABEL[computeStatus(w)]}</span>
      <span class="muted">${esc(w.meaning_cn||"(无中文)")}</span>
      ${miss.length?`<div class="miss">缺失项：<br>${miss.map(x=>"· "+esc(x)).join("<br>")}</div>`:`<div style="color:var(--ok);font-size:11px">✓ 整理完成</div>`}
      <div style="margin-top:8px">推荐下一步：${nextBtns.join(" ")}</div></div>`;
  };
  const opt=(v,l)=>`<option value="${v}"${poolLevel===v?" selected":""}>${l}</option>`;
  p.innerHTML=`<h2>待串联词池 <span class="muted">(未完成 ${scope.length})</span></h2>
    <p class="muted" style="margin-bottom:12px">显示所有尚未“整理完成”的词（不限等级）。缺失项比状态更重要。</p>
    <div class="search-row">
      <input id="pool-search" placeholder="搜索德语 / 中文…" value="${esc(poolSearch)}" oninput="onPoolSearch(this.value)">
      <select id="pool-level" onchange="onPoolLevel(this.value)">${opt("","全部等级")}${opt("A1","A1")}${opt("A2","A2")}${opt("B1","B1")}${opt("B2","B2")}</select>
    </div>
    ${pagerHTML(pg,"poolGoto")}
    ${pg.slice.map(row).join("")||"<p class='muted'>没有匹配的待整理词</p>"}
    ${pg.total>PAGE_SIZE?pagerHTML(pg,"poolGoto"):""}`;
  const si=document.getElementById("pool-search");
  if(si&&document.activeElement!==si&&poolSearch){si.focus();si.setSelectionRange(si.value.length,si.value.length);}
}
window.onPoolSearch=v=>{poolSearch=v;pageState.pool=1;renderPool();};
window.onPoolLevel=v=>{poolLevel=v;pageState.pool=1;renderPool();};
window.poolGoto=pg=>{pageState.pool=pg;renderPool();};

/* ============ 专题 ============ */
function renderTopics(){
  const p=document.getElementById("page-topics");
  const roots=DB.topics.filter(t=>!t.parent_topic);
  const renderTopic=t=>{
    const members=DB.words.filter(w=>(w.topic_ids||[]).includes(t.id));
    const subs=DB.topics.filter(x=>x.parent_topic===t.id);
    return `<div class="card">
      <b>${esc(t.name_de)}</b> <span class="muted">${esc(t.name_cn)}</span>
      <button class="danger" style="float:right" onclick="delTopic('${t.id}')">删</button>
      <div class="muted">${esc(t.description||"")}</div>
      <div style="margin-top:6px">${members.slice(0,120).map(w=>`<span class="pill" onclick="goEditWord('${w.id}')"><span class="st-${computeStatus(w)}">●</span> ${esc(w.word)} · ${esc(w.meaning_cn)}</span>`).join("")||"<span class='muted'>暂无单词</span>"}${members.length>120?`<span class="muted">…等 ${members.length} 个</span>`:""}</div>
      ${subs.length?`<div style="margin-left:20px;margin-top:10px">${subs.map(renderTopic).join("")}</div>`:""}
    </div>`;
  };
  p.innerHTML=`<h2>专题</h2>
    <div class="card"><b>新建专题</b>
      <div class="form-grid" style="margin-top:8px;max-width:940px">
        <div><label>德语名*</label><input id="nt-de"></div>
        <div><label>中文名</label><input id="nt-cn"></div>
        <div><label>父专题</label><select id="nt-parent"><option value="">(顶级)</option>${DB.topics.map(t=>`<option value="${t.id}">${esc(t.name_de)}</option>`).join("")}</select></div>
        <div><label>等级</label><select id="nt-level"><option>A2</option><option selected>B1</option><option>B2</option></select></div>
        <div class="full"><label>说明</label><input id="nt-desc"></div>
      </div>
      <button class="primary" style="margin-top:8px" onclick="addTopic()">创建专题</button>
    </div>
    ${roots.map(renderTopic).join("")||"<p class='muted'>暂无专题</p>"}`;
}
window.addTopic=()=>{
  const de=val("nt-de").trim();if(!de){alert("德语名必填");return;}
  const used=new Set(DB.topics.map(t=>t.id));
  DB.topics.push({id:makeTopicSlug(de,used),name_de:de,name_cn:val("nt-cn").trim(),description:val("nt-desc").trim(),parent_topic:val("nt-parent")||null,level:val("nt-level"),tags:[],created_at:now(),updated_at:now()});
  save();renderTopics();
};
window.delTopic=id=>{
  if(!confirm("删除专题?(单词的 topic_ids 引用会被清理)"))return;
  DB.topics=DB.topics.filter(t=>t.id!==id);
  DB.topics.forEach(t=>{if(t.parent_topic===id)t.parent_topic=null;});
  DB.words.forEach(w=>{w.topic_ids=(w.topic_ids||[]).filter(x=>x!==id);});
  if(DB.settings.positions)delete DB.settings.positions[id];
  save();renderTopics();
};

/* ============ 易混淆组(搜索 + 分页) ============ */
let editingCgId=null;
let cgSearch="";
function renderConfusion(){
  const p=document.getElementById("page-confusion");
  const wordOpts=DB.words.slice(0,500).map(w=>`<option value="${w.id}">${esc(w.word)} · ${esc(w.meaning_cn)}</option>`).join("");
  const g=editingCgId?DB.confusion_groups.find(x=>x.id===editingCgId):null;
  const memberEditor=g?g.word_ids.map(wid=>{
    const w=wordById(wid);
    const ex=(g.examples||[]).find(e=>e.word===(w?w.word:""))||{cn:"",usage:"",collocation:"",example_de:"",example_cn:""};
    return `<div class="card" style="margin:6px 0">
      <b>${w?esc(w.word):"(失效)"+esc(wid)}</b>
      <button class="danger" style="float:right" onclick="cgRemoveWord('${wid}')">移除</button>
      <label>中文近似</label><input value="${esc(ex.cn)}" onchange="cgSetEx('${wid}','cn',this.value)">
      <label>使用场景</label><input value="${esc(ex.usage)}" onchange="cgSetEx('${wid}','usage',this.value)">
      <label>常用搭配</label><input value="${esc(ex.collocation)}" onchange="cgSetEx('${wid}','collocation',this.value)">
      <label>对比例句(德)</label><input value="${esc(ex.example_de)}" onchange="cgSetEx('${wid}','example_de',this.value)">
      <label>对比例句(中)</label><input value="${esc(ex.example_cn)}" onchange="cgSetEx('${wid}','example_cn',this.value)">
    </div>`;
  }).join(""):"";
  let listGroups=DB.confusion_groups.slice();
  if(cgSearch){const s=cgSearch.toLowerCase();listGroups=listGroups.filter(x=>(x.name_de||"").toLowerCase().includes(s)||(x.name_cn||"").toLowerCase().includes(s)||(x.examples||[]).some(e=>(e.word||"").toLowerCase().includes(s)));}
  const pg=paginate(listGroups,pageState.confusion);
  pageState.confusion=pg.page;
  const groupCard=x=>{
    const rows=(x.examples||[]).map(e=>`<tr><td><b>${esc(e.word)}</b></td><td>${esc(e.cn)}</td><td>${esc(e.usage)}</td><td>${esc(e.collocation)}</td><td>${esc(e.example_de)}${e.example_cn?"<br><span class='muted'>"+esc(e.example_cn)+"</span>":""}</td></tr>`).join("");
    return `<div class="card">
      <b>${esc(x.name_cn||x.name_de)}</b> ${x.name_cn?`<span class="muted">${esc(x.name_de)}</span>`:""}
      <span style="float:right"><button onclick="editingCgId='${x.id}';renderConfusion()">编辑区别</button> <button onclick="cgViewInGraph('${x.id}')">在图谱中查看</button> <button class="danger" onclick="cgDelete('${x.id}')">删除</button></span>
      <div class="muted" style="margin:6px 0">${esc(x.explanation)}</div>
      <table><thead><tr><th>德语词</th><th>中文近似</th><th>使用场景</th><th>常用搭配</th><th>例句</th></tr></thead><tbody>${rows||"<tr><td colspan='5' class='muted'>暂无成员</td></tr>"}</tbody></table></div>`;
  };
  p.innerHTML=`<h2>易混淆组 <span class="muted">(${DB.confusion_groups.length})</span></h2>
    <div class="card"><b>${g?"编辑组: "+esc(g.name_de):"新建易混淆组"}</b>
      <label>组名(德)*</label><input id="cg-de" value="${g?esc(g.name_de):""}">
      <label>组名(中)</label><input id="cg-cn" value="${g?esc(g.name_cn):""}">
      <label>总体说明</label><textarea id="cg-exp">${g?esc(g.explanation):""}</textarea>
      <div style="margin-top:8px">
        ${g?`<button class="primary" onclick="cgSaveMeta()">保存组信息</button> <button onclick="editingCgId=null;renderConfusion()">取消编辑</button> <button onclick="cgViewInGraph('${g.id}')">在图谱中查看本组</button>`:`<button class="primary" onclick="cgCreate()">创建组</button>`}
      </div>
      ${g?`<hr><b>添加词到本组</b>${DB.words.length?`<div style="margin:6px 0"><select id="cg-addword">${wordOpts}</select> <button onclick="cgAddWord()">添加</button> <span class="muted" style="font-size:11px">${DB.words.length>500?"下拉仅列前 500，词多时建议从图谱详情面板加入":""}</span></div>`:'<p class="muted">词库为空，先添加单词</p>'}${memberEditor}`:""}
    </div>
    <div class="search-row"><input id="cg-search" placeholder="搜索组名 / 成员词…" value="${esc(cgSearch)}" oninput="onCgSearch(this.value)"></div>
    ${pagerHTML(pg,"cgGoto")}
    ${pg.slice.map(groupCard).join("")||(g?"":"<p class='muted'>无匹配的易混淆组</p>")}
    ${pg.total>PAGE_SIZE?pagerHTML(pg,"cgGoto"):""}`;
  const si=document.getElementById("cg-search");
  if(si&&document.activeElement!==si&&cgSearch){si.focus();si.setSelectionRange(si.value.length,si.value.length);}
}
window.onCgSearch=v=>{cgSearch=v;pageState.confusion=1;renderConfusion();};
window.cgGoto=pg=>{pageState.confusion=pg;renderConfusion();};
window.cgCreate=()=>{const de=val("cg-de").trim();if(!de){alert("组名(德)必填");return;}const used=new Set(DB.confusion_groups.map(g=>g.id));const id=makeConfusionSlug(de,used);DB.confusion_groups.push({id,name_de:de,name_cn:val("cg-cn").trim(),word_ids:[],explanation:val("cg-exp").trim(),examples:[],created_at:now(),updated_at:now()});editingCgId=id;save();renderConfusion();};
window.cgSaveMeta=()=>{const g=DB.confusion_groups.find(x=>x.id===editingCgId);if(!g)return;g.name_de=val("cg-de").trim()||g.name_de;g.name_cn=val("cg-cn").trim();g.explanation=val("cg-exp").trim();g.updated_at=now();save();renderConfusion();};
window.cgDelete=id=>{if(!confirm("删除该易混淆组?"))return;DB.confusion_groups=DB.confusion_groups.filter(g=>g.id!==id);if(editingCgId===id)editingCgId=null;save();renderConfusion();};
window.cgAddWord=()=>{const g=DB.confusion_groups.find(x=>x.id===editingCgId);if(!g)return;const wid=val("cg-addword");if(!g.word_ids.includes(wid)){g.word_ids.push(wid);const w=wordById(wid);if(w&&!(g.examples||[]).some(e=>e.word===w.word))g.examples.push({word:w.word,cn:w.meaning_cn,usage:"",collocation:"",example_de:"",example_cn:""});g.updated_at=now();save();}renderConfusion();};
window.cgRemoveWord=wid=>{const g=DB.confusion_groups.find(x=>x.id===editingCgId);if(!g)return;const w=wordById(wid);g.word_ids=g.word_ids.filter(x=>x!==wid);if(w)g.examples=(g.examples||[]).filter(e=>e.word!==w.word);g.updated_at=now();save();renderConfusion();};
window.cgSetEx=(wid,field,value)=>{const g=DB.confusion_groups.find(x=>x.id===editingCgId);if(!g)return;const w=wordById(wid);if(!w)return;let ex=(g.examples||[]).find(e=>e.word===w.word);if(!ex){ex={word:w.word,cn:"",usage:"",collocation:"",example_de:"",example_cn:""};g.examples.push(ex);}ex[field]=value;g.updated_at=now();save();};
window.cgViewInGraph=id=>{const g=DB.confusion_groups.find(x=>x.id===id);if(!g)return;switchPage("graph");setTimeout(()=>{document.getElementById("g-view").value="confusion";renderGraph();},50);};

/* ============ 串联检查(搜索 + 分页 + 建议按需计算 + 分桶) ============ */
let checkSearch="";
let linkableCache=null;
function invalidateLinkable(){linkableCache=null;}
function computeLinkable(){
  const buckets=new Map();
  const put=(key,w)=>{if(!key)return;let b=buckets.get(key);if(!b){b=[];buckets.set(key,b);}b.push(w);};
  DB.words.forEach(w=>{
    (w.topic_ids||[]).forEach(t=>put("topic:"+t,w));
    if(w.prefix)put("prefix:"+w.prefix,w);
    coerceStr(w.meaning_cn).split(/[，,、；;/\s]+/).map(x=>x.trim()).filter(x=>x.length>=2).forEach(kw=>put("cn:"+kw,w));
  });
  const edgeSet=new Set();
  DB.edges.forEach(e=>{edgeSet.add(e.from<e.to?e.from+"|"+e.to:e.to+"|"+e.from);});
  const pairReasons=new Map();
  const BUCKET_CAP=400;
  for(const [key,arr] of buckets){
    if(arr.length<2||arr.length>BUCKET_CAP)continue;
    const reason=key.startsWith("topic:")?"同专题":key.startsWith("prefix:")?"同前缀 "+key.slice(7):"中文重叠";
    for(let i=0;i<arr.length;i++)for(let j=i+1;j<arr.length;j++){
      const a=arr[i],b=arr[j];
      const pk=a.id<b.id?a.id+"|"+b.id:b.id+"|"+a.id;
      if(edgeSet.has(pk))continue;
      let r=pairReasons.get(pk);
      if(!r){r={a:a.id<b.id?a:b,b:a.id<b.id?b:a,reasons:new Set()};pairReasons.set(pk,r);}
      r.reasons.add(reason);
    }
  }
  return [...pairReasons.values()].map(r=>({a:r.a,b:r.b,reasons:[...r.reasons]}));
}
function renderCheck(){
  const p=document.getElementById("page-check");
  const s=checkSearch.toLowerCase();
  const flt=arr=>s?arr.filter(w=>w.word.toLowerCase().includes(s)||(w.meaning_cn||"").toLowerCase().includes(s)):arr;
  const isolated=flt(DB.words.filter(w=>wordEdges(w.id).length===0&&!(w.topic_ids||[]).length));
  const topicNoLink=flt(DB.words.filter(w=>(w.topic_ids||[]).length>0&&wordEdges(w.id).length===0));
  const edgeNoNoteAll=DB.edges.filter(e=>!coerceStr(e.note).trim()).map(e=>({e,f:wordById(e.from),t:wordById(e.to)})).filter(x=>x.f&&x.t);
  const edgeNoNote=s?edgeNoNoteAll.filter(x=>x.f.word.toLowerCase().includes(s)||x.t.word.toLowerCase().includes(s)):edgeNoNoteAll;
  const needDist=flt(DB.words.filter(w=>{
    const flagged=w.needs_contrast||wordEdges(w.id).some(e=>e.type==="confusion"||e.type==="chinese_overlap")||DB.confusion_groups.some(g=>(g.word_ids||[]).includes(w.id));
    return flagged&&!hasDistinction(w);
  }));
  const notComplete=flt(DB.words.filter(w=>computeStatus(w)!=="complete"));
  const pillPage=(arr,key,gotoFn)=>{
    const pg=paginate(arr,pageState[key]);pageState[key]=pg.page;
    return `<div style="margin-top:6px">${pg.slice.map(w=>`<span class="pill" onclick="goEditWord('${w.id}')">${esc(w.word)}</span>`).join("")||"<span class='muted'>无</span>"}</div>${arr.length>PAGE_SIZE?pagerHTML(pg,gotoFn):`<div style="color:var(--muted);font-size:11px;margin-top:4px">共 ${arr.length}</div>`}`;
  };
  const edgePage=(arr,key,gotoFn)=>{
    const pg=paginate(arr,pageState[key]);pageState[key]=pg.page;
    return `<div style="margin-top:6px">${pg.slice.map(x=>`<span class="pill" onclick="showEdgeInGraph('${x.e.id}')">${esc(x.f.word)}–${esc(x.t.word)}</span>`).join("")||"<span class='muted'>无</span>"}</div>${arr.length>PAGE_SIZE?pagerHTML(pg,gotoFn):`<div style="color:var(--muted);font-size:11px;margin-top:4px">共 ${arr.length}</div>`}`;
  };
  const sec=(title,inner)=>`<div class="card"><b>${title}</b>${inner}</div>`;
  let linkableBlock;
  if(linkableCache===null){
    linkableBlock=`<div class="muted" style="font-size:12px">中文重叠 / 同前缀 / 同专题，且尚无直接关系。词量大时计算较重，点击按需生成。</div>
      <button style="margin-top:8px" onclick="runLinkable()">计算可连接建议</button>`;
  }else{
    let list=linkableCache;
    if(s)list=list.filter(x=>x.a.word.toLowerCase().includes(s)||x.b.word.toLowerCase().includes(s));
    const pg=paginate(list,pageState.check_linkable);pageState.check_linkable=pg.page;
    linkableBlock=`<div class="muted" style="font-size:12px">中文重叠 / 同前缀 / 同专题，且尚无直接关系 (启发式，共 ${list.length} 组)</div>
      <button style="margin:8px 0" onclick="runLinkable()">重新计算</button>
      <div>${pg.slice.map(x=>`<span class="pill" onclick="goEditWord('${x.a.id}')">${esc(x.a.word)} ↔ ${esc(x.b.word)} <span class="muted">(${x.reasons.join(",")})</span></span>`).join("")||"<span class='muted'>无</span>"}</div>
      ${list.length>PAGE_SIZE?pagerHTML(pg,"checkLinkableGoto"):""}`;
  }
  p.innerHTML=`<h2>串联检查</h2>
    <p class="muted" style="margin-bottom:12px">词汇网络的质量控制中心。点击词跳转编辑。搜索对所有分类生效。</p>
    <div class="search-row"><input id="check-search" placeholder="搜索德语 / 中文…" value="${esc(checkSearch)}" oninput="onCheckSearch(this.value)"></div>
    ${sec(`孤立词 (无专题也无关系) · ${isolated.length}`,pillPage(isolated,"check_isolated","checkIsolatedGoto"))}
    ${sec(`只有专题、没有词汇连接 · ${topicNoLink.length}`,`<div class="muted" style="font-size:12px">已加入专题但未连到任何词</div>${pillPage(topicNoLink,"check_topicNoLink","checkTopicNoLinkGoto")}`)}
    ${sec(`有关系但无关系说明 · ${edgeNoNote.length}`,`<div class="muted" style="font-size:12px">边存在但 note 为空</div>${edgePage(edgeNoNote,"check_edgeNoNote","checkEdgeNoNoteGoto")}`)}
    ${sec(`需要区别说明但未写 · ${needDist.length}`,`<div class="muted" style="font-size:12px">标记需对比、或在易混淆组/confusion 关系中，但没写 usage / note</div>${pillPage(needDist,"check_needDist","checkNeedDistGoto")}`)}
    ${sec(`未完成整理 (全等级) · ${notComplete.length}`,pillPage(notComplete,"check_notComplete","checkNotCompleteGoto"))}
    ${sec(`可能可以连接的词`,linkableBlock)}`;
  const si=document.getElementById("check-search");
  if(si&&document.activeElement!==si&&checkSearch){si.focus();si.setSelectionRange(si.value.length,si.value.length);}
}
window.onCheckSearch=v=>{checkSearch=v;["check_isolated","check_topicNoLink","check_edgeNoNote","check_needDist","check_notComplete","check_linkable"].forEach(k=>pageState[k]=1);renderCheck();};
window.runLinkable=()=>{linkableCache=computeLinkable();pageState.check_linkable=1;renderCheck();};
window.checkIsolatedGoto=pg=>{pageState.check_isolated=pg;renderCheck();};
window.checkTopicNoLinkGoto=pg=>{pageState.check_topicNoLink=pg;renderCheck();};
window.checkEdgeNoNoteGoto=pg=>{pageState.check_edgeNoNote=pg;renderCheck();};
window.checkNeedDistGoto=pg=>{pageState.check_needDist=pg;renderCheck();};
window.checkNotCompleteGoto=pg=>{pageState.check_notComplete=pg;renderCheck();};
window.checkLinkableGoto=pg=>{pageState.check_linkable=pg;renderCheck();};
window.showEdgeInGraph=id=>{switchPage("graph");setTimeout(()=>{if(network){network.selectEdges([id]);showEdgeDetail(id);}},50);};

/* ============ 词库(搜索 + 分页) ============ */
let tableSort={key:"word",asc:true};
let tableSearch="";
function degOf(id){return wordEdges(id).length;}
function renderTable(){
  const p=document.getElementById("page-table");
  let rows=DB.words.slice();
  const s=tableSearch.toLowerCase();
  if(s)rows=rows.filter(w=>w.word.toLowerCase().includes(s)||(w.meaning_cn||"").toLowerCase().includes(s));
  rows.sort((a,b)=>{const k=tableSort.key;let x,y;if(k==="rel"){x=degOf(a.id);y=degOf(b.id);}else if(k==="status"){x=STATUS_ORDER.indexOf(computeStatus(a));y=STATUS_ORDER.indexOf(computeStatus(b));}else if(k==="miss"){x=missingItems(a).length;y=missingItems(b).length;}else{x=a[k];y=b[k];}return(x>y?1:x<y?-1:0)*(tableSort.asc?1:-1);});
  const pg=paginate(rows,pageState.table);
  pageState.table=pg.page;
  const hdr=(k,t)=>`<th onclick="sortTable('${k}')">${t}${tableSort.key===k?(tableSort.asc?" ▲":" ▼"):""}</th>`;
  p.innerHTML=`<h2>词库 <span class="muted">(${rows.length}/${DB.words.length})</span></h2>
    <div class="search-row"><input id="t-search" placeholder="搜索德语 / 中文…" oninput="onTableSearch(this.value)" value="${esc(tableSearch)}"></div>
    ${pagerHTML(pg,"tableGoto")}
    <div style="overflow:auto"><table><thead><tr>
    ${hdr("word","单词")}${hdr("pos","词性")}${hdr("level","等级")}${hdr("meaning_cn","中文")}${hdr("status","整理状态")}<th>专题</th>${hdr("rel","关系数")}${hdr("needs_contrast","需对比")}${hdr("miss","缺失项")}<th></th>
    </tr></thead><tbody>
    ${pg.slice.map(w=>{const st=computeStatus(w);const miss=missingItems(w);return `<tr>
      <td><b>${esc(w.word)}</b></td><td>${esc(w.pos)}</td><td><span class="badge b-${w.level}">${w.level}</span></td>
      <td>${esc(w.meaning_cn)}</td><td class="st-${st}">${STATUS_LABEL[st]}</td>
      <td>${(w.topic_ids||[]).map(t=>esc(topicById(t)?.name_de||"")).join("、")}</td>
      <td>${degOf(w.id)}</td><td>${w.needs_contrast?"是":""}</td>
      <td class="miss">${miss.map(esc).join("<br>")}</td>
      <td><button onclick="goEditWord('${w.id}')">编辑</button></td></tr>`;}).join("")||`<tr><td colspan="10" class="muted">无匹配词条</td></tr>`}
    </tbody></table></div>
    ${pagerHTML(pg,"tableGoto")}`;
  const si=document.getElementById("t-search");
  if(si&&document.activeElement!==si&&tableSearch){si.focus();si.setSelectionRange(si.value.length,si.value.length);}
}
window.onTableSearch=v=>{tableSearch=v;pageState.table=1;renderTable();};
window.tableGoto=pg=>{pageState.table=pg;renderTable();};
window.sortTable=k=>{if(tableSort.key===k)tableSort.asc=!tableSort.asc;else{tableSort.key=k;tableSort.asc=true;}pageState.table=1;renderTable();};

/* ============ 数据 ============ */
function renderIO(){
  const p=document.getElementById("page-io");
  p.innerHTML=`<h2>数据导入 / 导出</h2>
    <p id="dirty-tip" style="font-weight:600"></p>
    <div class="card"><b>导出完整备份</b>
      <p class="muted" style="margin:6px 0">导出 words / edges / topics / confusion_groups / settings(含坐标) 完整 JSON。</p>
      <button class="primary" onclick="doExport()">导出 JSON 备份</button></div>
    <div class="card"><b>导入 JSON</b>
      <p class="muted" style="margin:6px 0">FileReader 读取本地文件(不用 fetch)。导入时执行 schema 校验、字段补全、非法值清洗、旧版本 ID 迁移。</p>
      <input type="file" id="io-file" accept=".json"><br><br>
      <button class="primary" onclick="doImport()">执行导入(覆盖当前词库)</button>
      <div id="io-report" style="margin-top:10px"></div></div>
    <div class="card"><b>危险操作</b><br><br>
      <button class="danger" onclick="if(confirm('清空为空库?')){DB=emptyDB();save();alert('已清空');switchPage('graph');}">清空为空库</button></div>
    <p class="muted">当前统计: ${DB.words.length} 词 · ${DB.edges.length} 关系 · ${DB.topics.length} 专题 · ${DB.confusion_groups.length} 易混淆组</p>`;
  updateDirtyIndicator();
}
window.doExport=()=>{storage.export(DB);dirty=false;updateDirtyIndicator();};
window.doImport=()=>{
  const file=document.getElementById("io-file").files[0];
  if(!file){alert("请选择文件");return;}
  const reader=new FileReader();
  reader.onload=e=>{
    const res=storage.import(e.target.result);
    if(!res.ok){document.getElementById("io-report").innerHTML=`<span style="color:var(--danger)">导入失败: ${esc(res.error)}</span>`;return;}
    DB=res.db;storage.save(DB);rebuildEdgeIndex();invalidateLinkable();dirty=false;updateDirtyIndicator();
    const r=res.report;
    document.getElementById("io-report").innerHTML=
      `<div style="color:var(--ok)">导入成功。词 ${DB.words.length} / 关系 ${DB.edges.length} / 专题 ${DB.topics.length} / 易混淆组 ${DB.confusion_groups.length}</div>`+
      `<div class="muted">ID 重映射 ${r.remapped} 项 · 修正 ${r.fixed.length} 项 · 丢弃 ${r.dropped.length} 项</div>`+
      (r.fixed.length?`<details><summary class="muted">修正详情</summary><div class="muted" style="font-size:12px">${r.fixed.map(esc).join("<br>")}</div></details>`:"")+
      (r.dropped.length?`<details><summary class="muted">丢弃详情</summary><div class="muted" style="font-size:12px">${r.dropped.map(esc).join("<br>")}</div></details>`:"");
  };
  reader.readAsText(file);
};

/* ============ 视图切换 ============ */
const RENDERERS={graph:()=>{bindGraphToolbar();renderGraph();},edit:renderEdit,pool:renderPool,topics:renderTopics,confusion:renderConfusion,check:renderCheck,table:renderTable,io:renderIO};
function switchPage(name){
  if(name!=="graph"&&linkMode){linkMode=false;linkFrom=null;}
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.page===name));
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id==="page-"+name));
  if(RENDERERS[name])RENDERERS[name]();
}
window.switchPage=switchPage;
document.querySelectorAll(".tab").forEach(t=>{if(t.dataset.page)t.onclick=()=>switchPage(t.dataset.page);});
function bindGraphToolbar(){
  bindGraphToolbarToggle();
  document.getElementById("g-view").onchange=()=>{
    if(document.getElementById("g-view").value!=="neighbor")focusSeed=null;
    renderGraph();
  };
  ["g-level","g-status","g-etype","g-topic"].forEach(id=>document.getElementById(id).onchange=()=>renderGraph());
  document.getElementById("g-search").oninput=()=>renderGraph();
  const ind=document.getElementById("g-indirect");if(ind)ind.onchange=()=>renderGraph();
  document.getElementById("g-reset").onclick=()=>{focusSeed=null;document.getElementById("g-view").value="global";renderGraph(true);};
  document.getElementById("g-status").innerHTML='<option value="">全部状态</option>'+STATUS_ORDER.map(s=>`<option value="${s}">${STATUS_LABEL[s]}</option>`).join("");
  document.getElementById("g-etype").innerHTML='<option value="">全部关系</option>'+REL_TYPES.map(r=>`<option value="${r[0]}">${r[1]}</option>`).join("");
  document.getElementById("g-topic").innerHTML='<option value="">全部专题</option>'+DB.topics.map(t=>`<option value="${t.id}">${esc(t.name_de)}</option>`).join("");
}
function setGraphToolbarCollapsed(collapsed){
  const toolbar = document.getElementById("graph-toolbar");
  const btn = document.getElementById("g-toolbar-toggle");
  if(!toolbar || !btn) return;
  toolbar.classList.toggle("collapsed", collapsed);
  btn.textContent = collapsed ? "图谱工具 ▸" : "图谱工具 ◂";
  btn.title = collapsed ? "展开筛选栏" : "收起筛选栏";
  btn.setAttribute("aria-expanded", String(!collapsed));
  localStorage.setItem("graph_toolbar_collapsed", collapsed ? "true" : "false");
}
function bindGraphToolbarToggle(){
  const btn = document.getElementById("g-toolbar-toggle");
  if(!btn || btn.dataset.bound === "1") return;
  const saved = localStorage.getItem("graph_toolbar_collapsed") === "true";
  setGraphToolbarCollapsed(saved);
  btn.onclick = () => {
    const toolbar = document.getElementById("graph-toolbar");
    const collapsed = !toolbar.classList.contains("collapsed");
    setGraphToolbarCollapsed(collapsed);
  };
  btn.dataset.bound = "1";
}

/* ============ beforeunload ============ */
window.addEventListener("beforeunload",e=>{if(dirty){e.preventDefault();e.returnValue="";return "";}});

/* ============ 启动 ============ */
initTheme();
load();
if(noLocalData){DB=emptyDB();storage.save(DB);dirty=false;}
switchPage("graph");
updateDirtyIndicator();