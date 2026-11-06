"use strict";
const fs=require("node:fs");
const path=require("node:path");

// Build and periodically refresh snapshots outside request handlers. This avoids
// synchronous disk access on every /assets GET and bounds enumeration work.
function createAssetCatalog(imagesDir, refreshMs=60000) {
  const folders=[
    {label:"Main",dir:imagesDir,prefix:"/images/"},
    {label:"Quick",dir:path.join(imagesDir,"quick"),prefix:"/images/quick/"}
  ];
  let snapshot=[];
  function refresh() {
    const next=[];
    for(const folder of folders) {
      try {
        const entries=fs.readdirSync(folder.dir,{withFileTypes:true});
        for(const entry of entries) {
          if(!entry.isFile()) continue;
          const name=entry.name;
          if(name.length>255 || !/\.(png|jpe?g|webp|gif|svg)$/i.test(name)) continue;
          next.push({name,label:folder.label,
            url:folder.prefix+encodeURIComponent(name)});
          if(next.length>=10000) break;
        }
      }catch { /* missing directory or permission issue: preserve other folders */ }
      if(next.length>=10000) break;
    }
    next.sort((a,b)=>a.label.localeCompare(b.label)||a.name.localeCompare(b.name));
    snapshot=next;
  }
  refresh();
  const timer=Number.isFinite(refreshMs)&&refreshMs>=1000 ?
    setInterval(refresh,refreshMs):null;
  timer?.unref();
  return {list:()=>snapshot.slice(),refresh,close:()=>{if(timer) clearInterval(timer);}};
}
module.exports={createAssetCatalog};
