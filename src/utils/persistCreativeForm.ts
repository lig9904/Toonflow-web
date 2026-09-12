import {onBeforeUnmount,watch} from 'vue';
/** Browser-session recovery only; never sends a draft to a server or an Agent. */
export function persistCreativeForm<T>(options:{key:()=>string;active:()=>boolean;read:()=>T;restore:(value:T)=>void}){
 let editingKey='';
 const persist=()=>{if(!editingKey || !options.active())return;try{sessionStorage.setItem(editingKey,JSON.stringify(options.read()));}catch{}};
 watch(options.active,active=>{
  if(active){editingKey=options.key();try{const raw=sessionStorage.getItem(editingKey);if(raw)options.restore(JSON.parse(raw));}catch{}}
  else if(editingKey){try{sessionStorage.removeItem(editingKey);}catch{}editingKey='';}
 },{immediate:true,flush:'post'});
 watch(options.read,persist,{deep:true,flush:'post'});
 onBeforeUnmount(persist);
}
