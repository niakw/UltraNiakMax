"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createAssetCatalog}=require("../services/artwork-catalog");
test("image catalog is cached and refreshed away from request handlers",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"ultramax-images-"));
 try {
  fs.mkdirSync(path.join(root,"quick"));
  fs.writeFileSync(path.join(root,"a.webp"),"test");
  fs.writeFileSync(path.join(root,"exclude.txt"),"no");
  fs.writeFileSync(path.join(root,"quick","b.png"),"test");
  const c=createAssetCatalog(root,0);
  try {
    assert.deepEqual(c.list().map(x=>x.name),["a.webp","b.png"]);
    fs.writeFileSync(path.join(root,"c.jpg"),"new");
    assert.equal(c.list().length,2);
    c.refresh();
    assert.equal(c.list().length,3);
    assert.equal(c.list().every(x=>x.url.startsWith("/images/")),true);
  }finally {c.close();}
 }finally {fs.rmSync(root,{recursive:true,force:true});}
});
