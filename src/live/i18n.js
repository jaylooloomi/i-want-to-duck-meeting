/* Bind only authored initial UI nodes. No observer or translation of meeting content. */
(() => {
 const catalog=window.DuckLocaleCatalog,key='duck-meeting:ui-language',languages=['zh-TW','en','ja','ko'];
 const valid=value=>languages.includes(value)?value:'zh-TW';
 let language='zh-TW';try{language=valid(localStorage.getItem(key));}catch{}
 const bindings=[];
 function t(source,values={}){
  source=String(source??'');const item=Object.hasOwn(catalog,source)?catalog[source]:null,index=languages.indexOf(language)-1;
  const text=index>=0&&item?item[index]:source;
  return String(text).replace(/\{(\w+)\}/g,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match);
 }
 function bind(){
  const walker=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
   const node=walker.currentNode,parent=node.parentElement;
   if(!parent||parent.closest('script,style,[data-locale-native],[data-meeting-content]'))continue;
   const source=node.nodeValue.trim();
   if(Object.hasOwn(catalog,source)){const prefix=node.nodeValue.slice(0,node.nodeValue.indexOf(source)),suffix=node.nodeValue.slice(node.nodeValue.indexOf(source)+source.length);bindings.push({node,source,prefix,suffix,previous:node.nodeValue});}
  }
  for(const node of document.querySelectorAll('[aria-label],[title],[placeholder]')){
   for(const attr of ['aria-label','title','placeholder']){const source=node.getAttribute(attr);if(Object.hasOwn(catalog,source))bindings.push({node,attr,source,previous:source});}
  }
 }
 function apply(value,persist=false,notify=true){
  language=valid(value);document.documentElement.lang=language==='zh-TW'?'zh-Hant':language;
  for(const binding of bindings){const {node,attr,source}=binding;if(!node.isConnected)continue;
   const current=attr?node.getAttribute(attr):node.nodeValue;
   if(current!==binding.previous)continue;
   const translated=attr?t(source):binding.prefix+t(source)+binding.suffix;
   if(attr)node.setAttribute(attr,translated);else node.nodeValue=translated;
   binding.previous=translated;
  }
  const select=document.getElementById('ui-language');if(select)select.value=language;
  if(persist){try{localStorage.setItem(key,language);}catch{const status=document.getElementById('workspace-message');if(status)status.textContent=t('瀏覽器未允許保存偏好，本次設定仍可使用。');}}
  if(notify)document.dispatchEvent(new CustomEvent('ui-language-change',{detail:{language}}));
 }
 window.DuckI18n=Object.freeze({t,get language(){return language;},setLanguage:value=>apply(value,true)});
 bind();apply(language,false,false);
 document.getElementById('ui-language')?.addEventListener('change',event=>apply(event.target.value,true));
 window.addEventListener('storage',event=>{if(event.key===key||event.key===null)apply(event.key===null?'zh-TW':event.newValue);});
})();
